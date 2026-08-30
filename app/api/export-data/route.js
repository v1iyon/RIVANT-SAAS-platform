import { createClient } from "@supabase/supabase-js";
import { requireUser, UnauthorizedError } from "@/lib/require-user";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function GET(req) {
  // email больше не берём из query — раньше это позволяло скачать чужой
  // полный экспорт данных, просто зная его email (см. п. 1.1 аудита).
  let email;
  try {
    ({ email } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }

  const { data: user } = await admin
    .from("users")
    .select("id, email, language, created_at")
    .eq("email", email)
    .maybeSingle();

  if (!user) return Response.json({ error: "user not found" }, { status: 404 });

  const { data: businesses } = await admin
    .from("businesses")
    .select("id, name, timezone, created_at")
    .eq("user_id", user.id);

  const businessIds = (businesses || []).map((b) => b.id);

  const { data: metrics } = businessIds.length
    ? await admin.from("metrics_computed").select("*").in("business_id", businessIds)
    : { data: [] };

  const { data: alerts } = businessIds.length
    ? await admin.from("alerts_log").select("*").in("business_id", businessIds)
    : { data: [] };

  // Дашборд считает CAC/расходы из expenses (см. app/api/metrics/route.ts),
  // но эта таблица раньше не попадала в экспорт — "скачать мои данные" был
  // неполным относительно того, что реально показывается пользователю.
  const { data: expenses } = businessIds.length
    ? await admin.from("expenses").select("*").in("business_id", businessIds)
    : { data: [] };

  // ФІКС (аудит 30.08.2026, знахідка №5): delete-account/route.js вже
  // явно чистить team_members і addon_subscriptions як персональні дані
  // (список запрошених колег з telegram_id/username; активні допуслуги) —
  // export-data мовчки не віддавав ці ж самі таблиці, тобто "скачати мої
  // дані" було вужчим за те, що реально видаляється. Приводимо у відповідність.
  const { data: teamMembers } = businessIds.length
    ? await admin.from("team_members").select("*").in("business_id", businessIds)
    : { data: [] };

  const { data: addonSubscriptions } = businessIds.length
    ? await admin.from("addon_subscriptions").select("*").in("business_id", businessIds)
    : { data: [] };

  // Список підключених інтеграцій — без ключів/секретів (api_key_encrypted,
  // config.webhook_secret_encrypted тощо), лише факт "що підключено і коли":
  // саме ці рядки видаляються в delete-account, і людина має право бачити,
  // що з цього приводу про неї зберігається.
  const { data: integrationsRaw } = businessIds.length
    ? await admin
        .from("integrations")
        .select("business_id, provider, status, key_preview, last_synced_at, created_at")
        .in("business_id", businessIds)
    : { data: [] };
  const integrations = integrationsRaw || [];

  const { data: subscription } = await admin
    .from("subscriptions")
    .select("plan, access_status, current_period_end, created_at")
    .eq("user_id", user.id)
    .maybeSingle();

  const exportPayload = {
    exported_at: new Date().toISOString(),
    account: user,
    subscription,
    businesses,
    integrations,
    metrics,
    expenses,
    alerts,
    team_members: teamMembers,
    addon_subscriptions: addonSubscriptions,
  };

  return new Response(JSON.stringify(exportPayload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="rivant-export-${Date.now()}.json"`,
    },
  });
}