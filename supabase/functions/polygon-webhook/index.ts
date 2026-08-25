// supabase/functions/polygon-webhook/index.ts
//
// Single source of truth for crypto payment confirmation. Alchemy Notify
// (Address Activity webhook) calls this whenever a USDC transfer lands on
// POLYGON_PAY_TO_ADDRESS. We:
//   1. Verify the HMAC-SHA256 signature over the RAW body before parsing
//      anything — reject immediately on any mismatch or missing header.
//   2. Match the transferred amount to exactly one pending order.
//   3. Mark the order paid, then branch on the order's kind:
//        - "plan"  (default, existing behavior): UPSERT `subscriptions`.
//        - "addon" (NEW): resolve business_id, then either INSERT
//          `service_orders` (one-time) or UPSERT `addon_subscriptions`
//          (recurring) — mirrors the addon block already shipped in
//          kofi-webhook/index.ts, so the two payment paths converge on
//          the exact same tables/shape.
//
// Docs: https://docs.alchemy.com/reference/notify-api-quickstart
//       (signing key is the per-webhook "Signing Key" from the dashboard,
//       NOT your Alchemy API key)
//
// --------------------------------------------------------------------------
// CHANGELOG (this patch — crypto for add-ons, п.1 of the plan):
//
//   Matching itself is UNCHANGED: still exact_amount_cents against
//   `orders` where status = 'pending'. Crypto orders for add-ons don't
//   need a fixed/known price here — whatever amount reserve_order (called
//   from lib/crypto-checkout.ts at order-creation time) assigned is
//   already unique and already sitting on the `orders` row, so this
//   webhook never has to know addon prices at all.
//
//   NEW: `orders` is assumed to now carry three extra columns so a
//   matched order can identify itself as a plan order or an addon order:
//     - kind         : 'plan' | 'addon'   (nullable — NULL/'plan' both
//                       fall through to the existing subscription path,
//                       so pre-existing plan rows keep working untouched)
//     - addon_kind    : 'order' | 'subscription' | null
//                       ('order' = one-time -> service_orders,
//                        'subscription' = recurring -> addon_subscriptions)
//     - addon_slug    : text | null  (e.g. 'whatif_analysis',
//                       'monthly_digest', 'team_alerts' — same slugs
//                       already used as service_type/addon_type values in
//                       kofi-webhook, so downstream code doesn't need to
//                       special-case which payment method was used)
//
//   ⚠️ These column names are ASSUMED to match your actual `orders`
//   schema/migration — if you named them differently (or store this some
//   other way, e.g. a separate `order_addons` table), rename the four
//   spots marked "ADDON SCHEMA" below rather than trusting this blindly.
//   Whatever lib/crypto-checkout.ts writes when reserving an addon order
//   MUST use the same columns/values this file reads.
//
//   ADDON_SUBSCRIPTION_DAYS mirrors kofi-webhook's SUBSCRIPTION_DAYS (30)
//   for the manual-renewal addon_subscriptions period.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALCHEMY_SIGNING_KEY = Deno.env.get("ALCHEMY_WEBHOOK_SIGNING_KEY")!;
const PAY_TO_ADDRESS = (Deno.env.get("POLYGON_PAY_TO_ADDRESS") ?? "").toLowerCase();
const USDC_CONTRACT_POLYGON = (
  Deno.env.get("USDC_CONTRACT_ADDRESS") ??
  "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359" // native USDC on Polygon PoS
).toLowerCase();
const SUBSCRIPTION_PERIOD_DAYS = 30;
const ADDON_SUBSCRIPTION_DAYS = 30; // mirrors kofi-webhook's SUBSCRIPTION_DAYS
const AMOUNT_TOLERANCE_CENTS = 0; // exact match required; raise if you need slack for gas-rebate style transfers

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifySignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader) return false;
  if (!ALCHEMY_SIGNING_KEY) {
    console.error("ALCHEMY_WEBHOOK_SIGNING_KEY not configured");
    return false;
  }
  const expected = await hmacSha256Hex(ALCHEMY_SIGNING_KEY, rawBody);
  return timingSafeEqualHex(expected, signatureHeader.toLowerCase());
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Same shape/spirit as kofi-webhook's logError — errors_logs entries so a
// human can review anything the webhook couldn't resolve automatically.
async function logError(
  admin: ReturnType<typeof createClient>,
  message: string,
  details: Record<string, unknown>,
) {
  await admin.from("error_logs").insert({
    source: "polygon-webhook",
    message,
    details: JSON.stringify(details),
    resolved: false,
  });
}

// --- ADDON SCHEMA: row shape matched from `orders` ------------------------
interface MatchedOrderRow {
  id: string;
  user_id: string;
  plan_id: string | null;
  exact_amount_cents: number;
  status: string;
  kind: string | null; // 'plan' | 'addon' | null
  addon_kind: string | null; // 'order' | 'subscription' | null
  addon_slug: string | null;
}

// Handles a matched+paid order whose kind === 'addon'. Mirrors kofi-webhook
// section "5. Допуслуги" (business_id resolution with the same 0-or-many
// error_logs fallback, service_orders insert / addon_subscriptions upsert).
async function processAddonOrder(
  admin: ReturnType<typeof createClient>,
  order: MatchedOrderRow,
  hash: string,
): Promise<{ matched: boolean; reason?: string }> {
  if (!order.addon_kind || !order.addon_slug) {
    console.error("polygon-webhook: order.kind = 'addon' but addon_kind/addon_slug missing", order.id);
    await logError(admin, "Addon order missing addon_kind/addon_slug", { order_id: order.id, hash });
    return { matched: false, reason: "addon_metadata_missing" };
  }

  const { data: userBusinesses, error: businessesError } = await admin
    .from("businesses")
    .select("id")
    .eq("user_id", order.user_id);

  if (businessesError) {
    console.error("polygon-webhook: business lookup failed", businessesError);
    await logError(admin, "Addon order: business lookup failed", {
      order_id: order.id,
      user_id: order.user_id,
      error: businessesError.message,
    });
    return { matched: false, reason: "business_lookup_failed" };
  }

  if (!userBusinesses || userBusinesses.length !== 1) {
    console.warn(`polygon-webhook: ambiguous business_id, user=${order.user_id}, count=${userBusinesses?.length ?? 0}`);
    await logError(admin, "Addon order: could not resolve a single business_id for user", {
      order_id: order.id,
      user_id: order.user_id,
      business_count: userBusinesses?.length ?? 0,
      addon_kind: order.addon_kind,
      addon_slug: order.addon_slug,
      hash,
    });
    return { matched: false, reason: "ambiguous_business_id" };
  }

  const businessId = userBusinesses[0].id as string;

  try {
    if (order.addon_kind === "order") {
      // One-time service (e.g. whatif_analysis) -> service_orders.
      const { error: orderError } = await admin.from("service_orders").insert({
        business_id: businessId,
        user_id: order.user_id,
        service_type: order.addon_slug,
        status: "pending",
      });
      if (orderError) throw orderError;
    } else if (order.addon_kind === "subscription") {
      // Recurring addon (monthly_digest, team_alerts) -> addon_subscriptions.
      const periodEnd = new Date(Date.now() + ADDON_SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { error: addonSubError } = await admin.from("addon_subscriptions").upsert(
        {
          business_id: businessId,
          addon_type: order.addon_slug,
          status: "active",
          current_period_end: periodEnd,
        },
        { onConflict: "business_id,addon_type" },
      );
      if (addonSubError) throw addonSubError;
    } else {
      console.error("polygon-webhook: unknown addon_kind", order.addon_kind);
      await logError(admin, "Addon order: unknown addon_kind", {
        order_id: order.id,
        addon_kind: order.addon_kind,
      });
      return { matched: false, reason: "unknown_addon_kind" };
    }
  } catch (err) {
    console.error("polygon-webhook: failed to process addon order", order.id, err);
    await logError(admin, "Failed to process crypto addon order", {
      order_id: order.id,
      business_id: businessId,
      addon_kind: order.addon_kind,
      addon_slug: order.addon_slug,
      error: (err as Error).message,
      hash,
    });
    return { matched: false, reason: "addon_write_failed" };
  }

  return { matched: true };
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // IMPORTANT: read the raw text body for signature verification BEFORE
  // any JSON.parse. Re-parsing/re-serializing would change byte layout
  // and break the signature check.
  const rawBody = await req.text();
  const signature = req.headers.get("x-alchemy-signature");

  const valid = await verifySignature(rawBody, signature);
  if (!valid) {
    console.warn("polygon-webhook: rejected request with invalid/missing signature");
    return json({ error: "invalid_signature" }, 401);
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Alchemy Address Activity payload shape: event.activity[] entries with
  // fromAddress, toAddress, value, asset, category, hash, rawContract.
  const activities: any[] = payload?.event?.activity ?? [];
  const results: Array<{ hash: string; matched: boolean; reason?: string }> = [];

  for (const activity of activities) {
    const hash: string = activity.hash;
    const toAddress: string = (activity.toAddress ?? "").toLowerCase();
    const contractAddress: string = (activity.rawContract?.address ?? "").toLowerCase();

    // Only accept USDC transfers to our own receiving address.
    if (toAddress !== PAY_TO_ADDRESS || contractAddress !== USDC_CONTRACT_POLYGON) {
      results.push({ hash, matched: false, reason: "not_our_address_or_token" });
      continue;
    }

    // activity.value is a decimal token amount (e.g. 99.34) for
    // erc20 transfers in Alchemy's payload — convert to cents.
    const decimalValue = Number(activity.value);
    if (!Number.isFinite(decimalValue)) {
      results.push({ hash, matched: false, reason: "unparseable_value" });
      continue;
    }
    const amountCents = Math.round(decimalValue * 100);

    // Idempotency: if we've already processed this tx hash, skip.
    const { data: alreadyProcessed } = await admin
      .from("orders")
      .select("id")
      .eq("tx_hash", hash)
      .maybeSingle();
    if (alreadyProcessed) {
      results.push({ hash, matched: false, reason: "already_processed" });
      continue;
    }

    // Match to a pending order by exact salted amount. NOTE: this SELECT
    // now also pulls kind/addon_kind/addon_slug (ADDON SCHEMA) so we know
    // after marking it paid whether to go down the plan path or the addon
    // path — the matching logic itself (exact_amount_cents) is untouched.
    let orderQuery = admin
      .from("orders")
      .select("id, user_id, plan_id, exact_amount_cents, status, kind, addon_kind, addon_slug")
      .eq("status", "pending");

    if (AMOUNT_TOLERANCE_CENTS > 0) {
      orderQuery = orderQuery
        .gte("exact_amount_cents", amountCents - AMOUNT_TOLERANCE_CENTS)
        .lte("exact_amount_cents", amountCents + AMOUNT_TOLERANCE_CENTS);
    } else {
      orderQuery = orderQuery.eq("exact_amount_cents", amountCents);
    }

    const { data: matchedOrderRaw, error: matchErr } = await orderQuery.maybeSingle();

    if (matchErr || !matchedOrderRaw) {
      results.push({ hash, matched: false, reason: "no_matching_pending_order" });
      // In production: alert on this. It means either an underpayment,
      // an expired order, or a transfer with no corresponding checkout.
      continue;
    }

    const matchedOrder = matchedOrderRaw as MatchedOrderRow;
    const now = new Date();

    // Mark the order paid. Same guard as before regardless of kind.
    const { error: orderUpdateErr } = await admin
      .from("orders")
      .update({ status: "paid", tx_hash: hash, paid_at: now.toISOString() })
      .eq("id", matchedOrder.id)
      .eq("status", "pending"); // guard against double-processing races

    if (orderUpdateErr) {
      console.error("failed to mark order paid", orderUpdateErr);
      results.push({ hash, matched: false, reason: "order_update_failed" });
      continue;
    }

    // --- ADDON SCHEMA: branch on kind --------------------------------
    // kind === 'addon' is the only new path; everything else (including
    // kind === null, for any pre-existing plan orders created before this
    // column existed) falls through to the original subscriptions upsert
    // exactly as before.
    if (matchedOrder.kind === "addon") {
      const addonResult = await processAddonOrder(admin, matchedOrder, hash);
      results.push({ hash, ...addonResult });
      continue;
    }

    // Original plan path — UNCHANGED.
    const periodEnd = new Date(now.getTime() + SUBSCRIPTION_PERIOD_DAYS * 24 * 60 * 60_000);

    // Single source of truth: UPSERT subscriptions. Every part of the
    // product reads access from this table, not from `users` or `orders`.
    const { error: subUpsertErr } = await admin
      .from("subscriptions")
      .upsert(
        {
          user_id: matchedOrder.user_id,
          plan_id: matchedOrder.plan_id,
          access_status: "active",
          current_period_end: periodEnd.toISOString(),
          last_order_id: matchedOrder.id,
          last_tx_hash: hash,
          updated_at: now.toISOString(),
        },
        { onConflict: "user_id" },
      );

    if (subUpsertErr) {
      console.error("failed to upsert subscription", subUpsertErr);
      results.push({ hash, matched: false, reason: "subscription_upsert_failed" });
      continue;
    }

    results.push({ hash, matched: true });
  }

  return json({ ok: true, processed: results });
});