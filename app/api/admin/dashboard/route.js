import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function checkAuth(req) {
  const secret = req.headers.get("x-admin-secret");
  return secret === process.env.ADMIN_SECRET;
}

// Цены тарифов в USD/мес — если у вас другие суммы, поправьте здесь.
// Это единственное место, где MRR зависит от предположения, а не от реальных данных.
const PLAN_PRICES_USD = {
  starter: 19,
  growth: 49,
  scale: 99,
};

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
    admin.from("subscriptions").select("*", { count: "exact", head: true }).eq("access_status", "active"),
    admin.from("subscriptions").select("*", { count: "exact", head: true }).eq("access_status", "trial"),
    admin.from("subscriptions").select("plan").eq("access_status", "active"),
    admin.from("error_logs").select("*", { count: "exact", head: true }).gte("created_at", startOfToday.toISOString()),
  ]);

  const mrrCents = (activePlans || []).reduce((sum, row) => {
    const price = PLAN_PRICES_USD[row.plan] || 0;
    return sum + price * 100;
  }, 0);

  return Response.json({
    totalUsers: totalUsers || 0,
    activeSubscriptions: activeSubscriptions || 0,
    trialUsers: trialUsers || 0,
    mrrCents,
    errorsToday: errorsToday || 0,
  });
}