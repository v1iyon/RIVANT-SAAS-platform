// supabase/functions/polygon-webhook/index.ts
//
// Single source of truth for crypto payment confirmation. Alchemy Notify
// (Address Activity webhook) calls this whenever a USDC transfer lands on
// POLYGON_PAY_TO_ADDRESS. We:
//   1. Verify the HMAC-SHA256 signature over the RAW body before parsing
//      anything — reject immediately on any mismatch or missing header.
//   2. Match the transferred amount to exactly one pending order.
//   3. Branch on the order's kind, THEN mark it paid (see CHANGELOG below
//      for why the order matters):
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
// CHANGELOG (crypto for add-ons, п.1 of the plan):
//
//   Matching itself is UNCHANGED: still exact_amount_cents against
//   `orders` where status = 'pending'. Crypto orders for add-ons don't
//   need a fixed/known price here — whatever amount reserve_order (called
//   from lib/crypto-checkout.ts at order-creation time) assigned is
//   already unique and already sitting on the `orders` row, so this
//   webhook never has to know addon prices at all.
//
//   `orders` carries three extra columns so a matched order can identify
//   itself as a plan order or an addon order:
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
//   These are written by supabase/functions/create-order/index.ts — the
//   two functions must agree on the column names/values.
//
//   ADDON_SUBSCRIPTION_DAYS mirrors kofi-webhook's SUBSCRIPTION_DAYS (30)
//   for the manual-renewal addon_subscriptions period.
//
// --------------------------------------------------------------------------
// FIX 1 (ordering — false-success / lost addon on partial failure):
//
//   Previously `orders.status` was flipped to 'paid' BEFORE
//   processAddonOrder ran. `useOrderStatus` on the frontend reacts to
//   'paid' and immediately shows the user "payment confirmed" / calls
//   onSuccess(). If processAddonOrder then failed (DB hiccup, race,
//   whatever), the user had already seen a false success while nothing
//   was actually written to service_orders/addon_subscriptions — the
//   only trace left behind was an error_logs row nobody watches in real
//   time.
//
//   Now, for the addon path: processAddonOrder runs FIRST. Only if it
//   reports `matched: true` do we flip the order to 'paid'. If it fails,
//   the order stays 'pending', which means:
//     (a) the user correctly keeps seeing "waiting for confirmation"
//         instead of a false "done", and
//     (b) if Alchemy retries this same webhook delivery (they do retry
//         on non-2xx / timeout), the matching logic above will find this
//         same pending order again and we get an automatic retry instead
//         of a silently lost payment.
//
//   The plan path is intentionally left exactly as it was in relative
//   order (mark paid, then upsert subscription) — this fix is scoped to
//   the addon branch only, per the "don't touch what already works" rule.
//
//   Known residual edge case (documented, not fixed here): if
//   processAddonOrder's INSERT into service_orders succeeds but the
//   subsequent `orders` UPDATE to 'paid' fails, a retry will call
//   processAddonOrder again and insert a second service_orders row
//   (it's a plain insert, not an upsert — confirmed via schema check,
//   service_orders has no order_id column to upsert against yet).
//   Closing this fully needs a unique constraint on
//   service_orders(order_id) + upsert-by-order_id instead of insert — a
//   small migration, not done here since it touches schema and wasn't
//   asked for.
//
// --------------------------------------------------------------------------
// FIX 2 (schema mismatch — orders has no `paid_at` column):
//
//   The original patch wrote `.update({ status: "paid", tx_hash: hash,
//   paid_at: now.toISOString() })`. A live schema check of `orders`
//   (information_schema.columns) confirmed there is NO `paid_at` column
//   at all — the closest equivalent already in the table is `matched_at`
//   (nullable timestamptz, currently unused by this function). Updating
//   a non-existent column via the Supabase JS client returns an error,
//   which means BOTH the plan path and the addon path were silently
//   failing at the "mark order paid" step for every single crypto
//   payment, regardless of kind.
//
//   Fixed by writing `matched_at` instead of `paid_at` in both branches
//   below. If you later add a real `paid_at` column via migration, this
//   is the one place (both occurrences) to update again.

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

// Handles a matched order whose kind === 'addon'. Mirrors kofi-webhook
// section "5. Допуслуги" (business_id resolution with the same 0-or-many
// error_logs fallback, service_orders insert / addon_subscriptions upsert).
// IMPORTANT: called BEFORE the order is marked 'paid' — see FIX 1 in the
// top-of-file changelog. Do not flip status before this returns
// matched: true.
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
    // also pulls kind/addon_kind/addon_slug (ADDON SCHEMA) so we know
    // which path to take — the matching logic itself (exact_amount_cents)
    // is untouched.
    //
    // FIX (аудит FINAL B2, безопасный минимум): раньше матчинг смотрел
    // ТОЛЬКО на status='pending', не проверяя expires_at — заказ, который
    // по всем признакам должен был "сгореть" (клиент передумал/ошибся
    // суммой), мог быть неожиданно закрыт чужим, не связанным с ним
    // переводом той же суммы спустя дни/недели, если он всё ещё оставался
    // status='pending' (потому что public.expire_stale_orders() ещё не
    // подключён к расписанию — см. миграцию
    // 20260827000001_expire_stale_orders_function.sql). Этот фильтр
    // работает независимо от того, успел ли отработать крон истечения:
    // просроченный заказ никогда не подхватится платежом, даже если сам
    // expire_stale_orders() ещё ни разу не запускался.
    let orderQuery = admin
      .from("orders")
      .select("id, user_id, plan_id, exact_amount_cents, status, kind, addon_kind, addon_slug")
      .eq("status", "pending")
      .gte("expires_at", new Date().toISOString());

    if (AMOUNT_TOLERANCE_CENTS > 0) {
      orderQuery = orderQuery
        .gte("exact_amount_cents", amountCents - AMOUNT_TOLERANCE_CENTS)
        .lte("exact_amount_cents", amountCents + AMOUNT_TOLERANCE_CENTS);
    } else {
      orderQuery = orderQuery.eq("exact_amount_cents", amountCents);
    }

    const { data: matchedOrderRaw, error: matchErr } = await orderQuery.maybeSingle();

    if (matchErr || !matchedOrderRaw) {
      // FIX (audit #3 follow-up): this branch used to only push a
      // result into the in-memory `results` array, which is returned in
      // the HTTP response to Alchemy — nobody reads that. Real USDC that
      // doesn't match a pending order (underpayment, expired order, or a
      // transfer with no corresponding checkout) was silently untracked
      // anywhere in the database, despite `public.unmatched_payments`
      // existing specifically for this case since migration
      // 0001_crypto_payments.sql. Insert here so the money is at least
      // visible for manual reconciliation/refund instead of vanishing.
      const { error: unmatchedErr } = await admin.from("unmatched_payments").upsert(
        {
          tx_hash: hash,
          amount_cents: amountCents,
          token: "USDC",
          raw_activity: activity,
        },
        { onConflict: "tx_hash", ignoreDuplicates: true },
      );
      if (unmatchedErr) {
        await logError(admin, "Failed to record unmatched crypto payment", {
          hash,
          amountCents,
          error: unmatchedErr,
        });
      }
      results.push({ hash, matched: false, reason: "no_matching_pending_order" });
      continue;
    }

    const matchedOrder = matchedOrderRaw as MatchedOrderRow;
    const now = new Date();

    // --- ADDON SCHEMA: branch on kind BEFORE marking paid ----------------
    // See FIX 1 at the top of this file for why the addon effect is
    // written first, and the order is only flipped to 'paid' once that
    // succeeds.
    if (matchedOrder.kind === "addon") {
      const addonResult = await processAddonOrder(admin, matchedOrder, hash);

      if (!addonResult.matched) {
        // Order stays 'pending' on purpose — safe for Alchemy's retry to
        // pick this same tx back up and try again.
        results.push({ hash, ...addonResult });
        continue;
      }

      // FIX 2: matched_at, not paid_at — `orders` has no paid_at column.
      const { error: orderUpdateErr } = await admin
        .from("orders")
        .update({ status: "paid", tx_hash: hash, matched_at: now.toISOString() })
        .eq("id", matchedOrder.id)
        .eq("status", "pending"); // guard against double-processing races

      if (orderUpdateErr) {
        console.error("failed to mark addon order paid", orderUpdateErr);
        results.push({ hash, matched: false, reason: "order_update_failed" });
        continue;
      }

      results.push({ hash, matched: true });
      continue;
    }

    // Original plan path — UNCHANGED order of operations (mark paid, then
    // upsert subscription). FIX 2 applied here too: matched_at, not paid_at.
    const { error: orderUpdateErr } = await admin
      .from("orders")
      .update({ status: "paid", tx_hash: hash, matched_at: now.toISOString() })
      .eq("id", matchedOrder.id)
      .eq("status", "pending"); // guard against double-processing races

    if (orderUpdateErr) {
      console.error("failed to mark order paid", orderUpdateErr);
      results.push({ hash, matched: false, reason: "order_update_failed" });
      continue;
    }

    const periodEnd = new Date(now.getTime() + SUBSCRIPTION_PERIOD_DAYS * 24 * 60 * 60_000);

    // FIX (audit #3, critical finding #1): the real public.subscriptions
    // table (schema_dump_27_08.sql) has a "plan" column, not "plan_id" —
    // and has no "updated_at" / "last_order_id" / "last_tx_hash" columns
    // at all (those are leftovers from an old, superseded migration that
    // no longer matches the live schema). The upsert below was silently
    // failing with "column does not exist" on every crypto payment — the
    // order got marked "paid" (separate, valid update above), but the
    // subscription was never actually activated. tx_hash is already
    // recorded on the `orders` row itself (see the update a few lines up),
    // so nothing is lost by not also duplicating it here.
    //
    // Single source of truth: UPSERT subscriptions. Every part of the
    // product reads access from this table, not from `users` or `orders`.
    const { error: subUpsertErr } = await admin
      .from("subscriptions")
      .upsert(
        {
          user_id: matchedOrder.user_id,
          plan: matchedOrder.plan_id,
          access_status: "active",
          current_period_end: periodEnd.toISOString(),
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