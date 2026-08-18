// supabase/functions/polygon-webhook/index.ts
//
// Single source of truth for payment confirmation. Alchemy Notify (Address
// Activity webhook) calls this whenever a USDC transfer lands on
// POLYGON_PAY_TO_ADDRESS. We:
//   1. Verify the HMAC-SHA256 signature over the RAW body before parsing
//      anything — reject immediately on any mismatch or missing header.
//   2. Match the transferred amount to exactly one pending order.
//   3. Mark the order paid, then UPSERT `subscriptions` — the only table
//      the rest of the product reads for access control.
//
// Docs: https://docs.alchemy.com/reference/notify-api-quickstart
//       (signing key is the per-webhook "Signing Key" from the dashboard,
//       NOT your Alchemy API key)

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

    // Match to a pending order by exact salted amount.
    let orderQuery = admin
      .from("orders")
      .select("id, user_id, plan_id, exact_amount_cents, status")
      .eq("status", "pending");

    if (AMOUNT_TOLERANCE_CENTS > 0) {
      orderQuery = orderQuery
        .gte("exact_amount_cents", amountCents - AMOUNT_TOLERANCE_CENTS)
        .lte("exact_amount_cents", amountCents + AMOUNT_TOLERANCE_CENTS);
    } else {
      orderQuery = orderQuery.eq("exact_amount_cents", amountCents);
    }

    const { data: matchedOrder, error: matchErr } = await orderQuery.maybeSingle();

    if (matchErr || !matchedOrder) {
      results.push({ hash, matched: false, reason: "no_matching_pending_order" });
      // In production: alert on this. It means either an underpayment,
      // an expired order, or a transfer with no corresponding checkout.
      continue;
    }

    const now = new Date();
    const periodEnd = new Date(now.getTime() + SUBSCRIPTION_PERIOD_DAYS * 24 * 60 * 60_000);

    // Mark the order paid.
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
