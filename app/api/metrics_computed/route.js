import { createClient } from "@supabase/supabase-js";
import { requireUser, UnauthorizedError } from "@/lib/require-user";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Сколько дней истории отдаём по тарифу — держим синхронно с текстом на лендинге
// ("Зберігання історії за 30/90 днів", "Необмежена історія").
const HISTORY_DAYS_BY_PLAN = {
  trial: 90,
  starter: 30,
  growth: 90,
  scale: 3650, // "неограниченно" на практике = не режем вообще
};

// FIX (аудит п.1): раньше email брался из query-параметра без проверки
// сессии — любой, кто знал/подобрал чужой email, получал чужую выручку,
// расходы и маржу. Теперь email берётся только из реальной сессии
// Supabase Auth, как во всех остальных роутах (см. lib/require-user.ts).
export async function GET(req) {
  let email;
  try {
    ({ email } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }

  const { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!appUser) return Response.json({ state: "not_connected" });

  const { data: business } = await admin
    .from("businesses")
    .select("id")
    .eq("user_id", appUser.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!business) return Response.json({ state: "not_connected" });

  const { data: integration } = await admin
    .from("integrations")
    .select("status")
    .eq("business_id", business.id)
    .eq("provider", "stripe")
    .maybeSingle();

  if (!integration || integration.status !== "connected") {
    return Response.json({ state: "not_connected" });
  }

  const { data: sub } = await admin
    .from("subscriptions")
    .select("plan")
    .eq("user_id", appUser.id)
    .maybeSingle();
  const plan = sub?.plan || "trial";
  const days = HISTORY_DAYS_BY_PLAN[plan] || 30;

  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().slice(0, 10);

  const { data: rows } = await admin
    .from("metrics_computed")
    .select("date, revenue, cost, margin_pct, orders")
    .eq("business_id", business.id)
    .gte("date", sinceStr)
    .order("date", { ascending: true });

  if (!rows || rows.length === 0) {
    return Response.json({ state: "waiting_first_sync" });
  }

  const totalRevenue = rows.reduce((s, r) => s + Number(r.revenue || 0), 0);
  const totalCost = rows.reduce((s, r) => s + Number(r.cost || 0), 0);
  const totalProfit = totalRevenue - totalCost;
  const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  return Response.json({
    state: "live",
    history: rows,
    totals: {
      revenue: totalRevenue,
      cost: totalCost,
      profit: totalProfit,
      marginPct: Number(avgMargin.toFixed(1)),
    },
  });
}