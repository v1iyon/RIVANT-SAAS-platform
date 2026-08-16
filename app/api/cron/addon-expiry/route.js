// app/api/cron/addon-expiry/route.js
//
// Раз на день перевіряє прострочені addon_subscriptions і "скидає" доступ:
// - status -> expired
// - усі team_members цього бізнесу -> revoked (саме той "сброс через месяц
//   по окончании оплаты у всех", про який просили — щоб знову отримати
//   сповіщення, учасникам потрібне буде нове запрошення після відновлення
//   оплати, а не автоматичне повернення).

import { createClient } from "@supabase/supabase-js";
import { isValidSecret } from "@/lib/verify-secret";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export async function GET(req) {
  // Timing-safe сравнение секрета — см. lib/verify-secret.js и п. 2.5 аудита.
  const secret = req.headers.get("x-cron-secret");
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  const isVercelCron = isValidSecret(bearerToken, process.env.CRON_SECRET);
  if (!isValidSecret(secret, process.env.CRON_SECRET) && !isVercelCron) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { data: expired } = await admin
    .from("addon_subscriptions")
    .select("id, business_id, addon_type")
    .eq("status", "active")
    .lt("current_period_end", new Date().toISOString());

  if (!expired?.length) return Response.json({ expired: 0 });

  let count = 0;
  for (const sub of expired) {
    await admin.from("addon_subscriptions").update({ status: "expired" }).eq("id", sub.id);

    if (sub.addon_type === "team_alerts") {
      await admin
        .from("team_members")
        .update({ status: "revoked", revoked_at: new Date().toISOString() })
        .eq("business_id", sub.business_id)
        .eq("status", "active");
    }
    count++;
  }

  return Response.json({ expired: count });
}
