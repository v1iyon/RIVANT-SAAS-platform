import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function checkAuth(req) {
  const secret = req.headers.get("x-admin-secret");
  return secret === process.env.ADMIN_SECRET;
}

// ВНИМАНИЕ: названия таблиц/полей ниже — предположение (users, subscriptions
// со status "active"/"trialing", subscriptions.plan_amount_cents).
// Пришлите реальную структуру таблицы subscriptions — поправлю запросы точно.
export async function GET(req) {
  if (!checkAuth(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [
    { count: totalUsers },
    { count: activeSubscriptions },
    { count: trialUsers },
    { data: activePlans },
    { count: errorsToday },
  ] = await Promise.all([
    admin.from("users").select("*", { count: "exact", head: true }),
    admin.from("subscriptions").select("*", { count: "exact", head: true }).eq("status", "active"),
    admin.from("subscriptions").select("*", { count: "exact", head: true }).eq("status", "trialing"),
    admin.from("subscriptions").select("plan_amount_cents").eq("status", "active"),
    admin.from("error_logs").select("*", { count: "exact", head: true }).gte("created_at", startOfToday.toISOString()),
  ]);

  const mrrCents = (activePlans || []).reduce((sum, row) => sum + (row.plan_amount_cents || 0), 0);

  return Response.json({
    totalUsers: totalUsers || 0,
    activeSubscriptions: activeSubscriptions || 0,
    trialUsers: trialUsers || 0,
    mrrCents,
    errorsToday: errorsToday || 0,
  });
}