// supabase/functions/create-order/index.ts
//
// Client sends ONLY { plan: "growth" }. The server:
//   1. Looks up the real price from the `plans` table (never trusts the client)
//   2. Picks a free cents_offset (1-99) so exact_amount_cents is unique among
//      pending orders — this is how polygon-webhook later disambiguates which
//      order a given on-chain transfer is paying for.
//   3. Writes the order with service_role, bypassing RLS by design.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAY_TO_ADDRESS = Deno.env.get("POLYGON_PAY_TO_ADDRESS")!; // your receiving wallet
const ORDER_TTL_MINUTES = 30;
const MAX_OFFSET_ATTEMPTS = 25;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // tighten to your domain in production
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Authenticate the caller using their own JWT (not service role) so we
  // know exactly which user this order belongs to.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing_authorization" }, 401);

  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "invalid_session" }, 401);
  const userId = userData.user.id;

  // Parse body — the ONLY thing we trust from the client is the plan id.
  let body: { plan?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const planId = body.plan;
  if (!planId || typeof planId !== "string") {
    return json({ error: "missing_plan" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 1. Server-side price lookup — never derived from client input.
  const { data: plan, error: planErr } = await admin
    .from("plans")
    .select("id, base_amount_cents, is_active")
    .eq("id", planId)
    .eq("is_active", true)
    .single();

  if (planErr || !plan) return json({ error: "unknown_plan" }, 400);

  const baseAmountCents = plan.base_amount_cents;

  // 2. Find a free cents_offset among currently-pending orders.
  //    Retry on unique-constraint collision instead of pre-reading pending
  //    offsets, to avoid a race between two checkouts picking the same one.
  const expiresAt = new Date(Date.now() + ORDER_TTL_MINUTES * 60_000).toISOString();

  for (let attempt = 0; attempt < MAX_OFFSET_ATTEMPTS; attempt++) {
    const centsOffset = 1 + Math.floor(Math.random() * 99); // 1..99
    const exactAmountCents = baseAmountCents + centsOffset;
    const exactAmountUsdc = (exactAmountCents / 100).toFixed(6);

    const { data: order, error: insertErr } = await admin
      .from("orders")
      .insert({
        user_id: userId,
        plan_id: plan.id,
        base_amount_cents: baseAmountCents,
        cents_offset: centsOffset,
        exact_amount_cents: exactAmountCents,
        exact_amount_usdc: exactAmountUsdc,
        pay_to_address: PAY_TO_ADDRESS,
        chain: "polygon",
        token: "USDC",
        status: "pending",
        expires_at: expiresAt,
      })
      .select("id, exact_amount_usdc, pay_to_address, chain, token, expires_at")
      .single();

    if (!insertErr) {
      return json({ order }, 201);
    }

    // 23505 = unique_violation on orders_pending_amount_unique -> retry
    if (insertErr.code !== "23505") {
      console.error("create-order insert failed", insertErr);
      return json({ error: "order_creation_failed" }, 500);
    }
  }

  // Extremely unlikely with 99 slots per plan, but fail loudly rather than
  // silently degrading pricing integrity.
  return json({ error: "no_offset_available_try_again" }, 503);
});
