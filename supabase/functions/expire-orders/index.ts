// supabase/functions/expire-orders/index.ts
//
// Запускать по расписанию (Supabase Cron, раз в 1-5 минут):
//   select cron.schedule('expire-orders', '*/2 * * * *',
//     $$ select net.http_post(
//          url := 'https://<project>.supabase.co/functions/v1/expire-orders',
//          headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>')
//        ) $$);
//
// Без этого просроченные pending-заказы навсегда занимают свой "хвост"
// центов (см. orders_pending_amount_unique) и мешают выдавать эту же
// сумму новым покупателям.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data, error } = await supabase
    .from("orders")
    .update({ status: "expired" })
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString())
    .select("id");

  if (error) {
    console.error("expire-orders error", error);
    return new Response(JSON.stringify({ error }), { status: 500 });
  }

  return new Response(JSON.stringify({ expired: data?.length ?? 0 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
