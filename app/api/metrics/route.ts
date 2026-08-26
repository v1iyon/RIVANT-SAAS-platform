// app/api/metrics/route.ts
import { createClient } from "@supabase/supabase-js";
import { getPrimaryBusinessId } from "@/lib/get-primary-business";
import {
  requireActiveSubscription,
  UnauthorizedError,
  SubscriptionInactiveError,
  subscriptionErrorResponse,
} from "@/lib/require-active-subscription";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const REVENUE_SOURCE_PROVIDERS = ["stripe", "shopify"];

const HISTORY_DAYS_BY_PLAN: Record<string, number> = {
  trial: 90,
  starter: 30,
  growth: 90,
  scale: 3650,
};
const DEFAULT_HISTORY_DAYS = 30;

async function fetchAllExpenses(businessId: string, sinceDate: string) {
  const all: { date: string; amount: number; category: string | null; source: string | null }[] = [];
  const pageSize = 1000;
  for (let page = 0; page < 100; page++) {
    const from = page * pageSize;
    const { data, error } = await admin
      .from("expenses")
      .select("date, amount, category, source")
      .eq("business_id", businessId)
      .gte("date", sinceDate)
      .order("date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      console.error("fetchAllExpenses error:", error);
      break;
    }
    const pageRows = data || [];
    all.push(...pageRows);
    if (pageRows.length < pageSize) break;
  }
  return all;
}

export async function GET(req: Request) {
  // п. B1 аудита: раньше requireUser() проверял только "залогинен ли
  // человек", plan использовался лишь для длины истории — access_status
  // не проверялся вообще. Теперь заблокированный/просроченный аккаунт
  // получает 402 до какого-либо чтения metrics_computed.
  let userId: string;
  let plan: string | null;
  try {
    ({ userId, plan } = await requireActiveSubscription());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (e instanceof SubscriptionInactiveError) return subscriptionErrorResponse(e);
    throw e;
  }

  const businessId = await getPrimaryBusinessId(admin, userId);
  if (!businessId) return Response.json({ hasData: false, rows: [] });

  const { data: revenueIntegrations } = await admin
    .from("integrations")
    .select("provider, status")
    .eq("business_id", businessId)
    .in("provider", REVENUE_SOURCE_PROVIDERS)
    .eq("status", "connected");

  if (!revenueIntegrations || revenueIntegrations.length === 0) {
    return Response.json({ hasData: false, rows: [] });
  }

  const historyDays = HISTORY_DAYS_BY_PLAN[plan || ""] ?? DEFAULT_HISTORY_DAYS;
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - historyDays);
  const sinceStr = sinceDate.toISOString().slice(0, 10);

  const { data: rawRows, error } = await admin
    .from("metrics_computed")
    .select("date, revenue, cost, margin_pct, orders")
    .eq("business_id", businessId)
    .gte("date", sinceStr)
    .order("date", { ascending: true });

  if (error || !rawRows || rawRows.length === 0) {
    return Response.json({ hasData: false, rows: [] });
  }

  const rows = rawRows.map((r) => ({
    date: r.date,
    revenue: Number(r.revenue) || 0,
    expenses: Number(r.cost) || 0,
    profit: Number(r.revenue) - Number(r.cost),
    margin_pct: Number(r.margin_pct) || 0,
    orders: Number(r.orders) || 0,
    cac: null as number | null,
    cacMeta: null as number | null,
    cacGoogle: null as number | null,
  }));

  const minDate = rows[0].date;
  const expenseRows = await fetchAllExpenses(businessId, minDate);
  const extraByDate: Record<string, { total: number; advertising: number; meta_ads: number; google_ads: number }> = {};
  for (const e of expenseRows || []) {
    if (!extraByDate[e.date]) extraByDate[e.date] = { total: 0, advertising: 0, meta_ads: 0, google_ads: 0 };
    const amount = Number(e.amount) || 0;
    extraByDate[e.date].total += amount;
    if (e.category === "advertising") {
      extraByDate[e.date].advertising += amount;
      if (e.source === "meta_ads") extraByDate[e.date].meta_ads += amount;
      if (e.source === "google_ads") extraByDate[e.date].google_ads += amount;
    }
  }

  for (const row of rows) {
    const extra = extraByDate[row.date];
    if (!extra) continue;
    row.expenses += extra.total;
    row.profit = row.revenue - row.expenses;
    row.margin_pct = row.revenue > 0 ? Number(((row.profit / row.revenue) * 100).toFixed(1)) : 0;
    row.cac = extra.advertising > 0 && row.orders > 0 ? Number((extra.advertising / row.orders).toFixed(2)) : null;
    row.cacMeta = extra.meta_ads > 0 && row.orders > 0 ? Number((extra.meta_ads / row.orders).toFixed(2)) : null;
    row.cacGoogle = extra.google_ads > 0 && row.orders > 0 ? Number((extra.google_ads / row.orders).toFixed(2)) : null;
  }

  return Response.json({ hasData: true, rows });
}