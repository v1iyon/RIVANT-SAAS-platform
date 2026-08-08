// app/api/cron/monthly-digest/route.js
// Раз на місяць (1 число, див. vercel.json) створює service_order для
// кожного бізнесу з активною підпискою "monthly_digest" — далі його
// підхоплює той самий /api/cron/process-service-orders.

import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export async function GET(req) {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { data: subs } = await admin
    .from("addon_subscriptions")
    .select("business_id")
    .eq("addon_type", "monthly_digest")
    .eq("status", "active")
    .gte("current_period_end", new Date().toISOString());

  if (!subs?.length) return Response.json({ created: 0 });

  let created = 0;
  for (const sub of subs) {
    const { data: business } = await admin.from("businesses").select("user_id").eq("id", sub.business_id).maybeSingle();
    if (!business) continue;

    await admin.from("service_orders").insert({
      business_id: sub.business_id,
      user_id: business.user_id,
      service_type: "monthly_digest",
      status: "pending",
    });
    created++;
  }

  return Response.json({ created });
}
