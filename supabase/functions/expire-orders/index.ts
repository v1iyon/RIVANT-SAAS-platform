// supabase/functions/expire-orders/index.ts
//
// Called every 5 minutes by pg_cron (see 20260818000002_cron_expire_orders.sql).
// The actual DB update is already done by public.expire_stale_orders() in SQL
// for reliability; this function re-runs the same guarded update (harmless,
// idempotent) and is the place to add side effects — logging, notifying
// users their checkout expired, metrics, etc.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET"); // optional shared secret

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Optional defense-in-depth: require a shared secret if this function is
  // reachable beyond the pg_cron -> pg_net call (e.g. if you also wire it
  // to an external scheduler). Not required when only pg_net calls it with
  // the service role key in the Authorization header, since Supabase's
  // gateway already checks that JWT.
  if (CRON_SECRET) {
    const provided = req.headers.get("x-cron-secret");
    if (provided !== CRON_SECRET) return json({ error: "unauthorized" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: expiredOrders, error } = await admin
    .from("orders")
    .update({ status: "expired" })
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString())
    .select("id, user_id, exact_amount_cents");

  if (error) {
    console.error("expire-orders failed", error);
    return json({ error: "expire_failed" }, 500);
  }

  if (expiredOrders && expiredOrders.length > 0) {
    console.log(`expired ${expiredOrders.length} stale order(s)`);
    // Hook point: send "your checkout expired" notification, emit metrics, etc.
  }

  return json({ ok: true, expired_count: expiredOrders?.length ?? 0 });
});
