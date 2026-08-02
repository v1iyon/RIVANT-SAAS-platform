// app/api/metrics/route.ts
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function GET(req: Request) {
  const email = new URL(req.url).searchParams.get("email");
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!appUser) return Response.json({ hasData: false, rows: [] });

  const { data: business } = await admin
    .from("businesses")
    .select("id")
    .eq("user_id", appUser.id)
    .maybeSingle();
  if (!business) return Response.json({ hasData: false, rows: [] });

  // Если Stripe отключён — данные не показываем вообще, даже если они
  // остались в metrics_computed с прошлого раза. Отключение интеграции
  // должно визуально откатывать дашборд к "как будто не подключали".
  const { data: stripeIntegration } = await admin
    .from("integrations")
    .select("status")
    .eq("business_id", business.id)
    .eq("provider", "stripe")
    .maybeSingle();

  if (!stripeIntegration || stripeIntegration.status !== "connected") {
    return Response.json({ hasData: false, rows: [] });
  }

  const { data: rawRows, error } = await admin
    .from("metrics_computed")
    .select("date, revenue, cost, margin_pct, orders")
    .eq("business_id", business.id)
    .order("date", { ascending: true })
    .limit(90);

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

  // Подмешиваем реальные расходы из expenses (Shopify shipping, Meta Ads
  // advertising — пишет shopify-sync.mjs / meta-ads-sync.mjs раз в час).
  // Без этого шага expenses копится в базе, но дашборд его никогда не видел.
  const minDate = rows[0].date;
  const { data: expenseRows } = await admin
    .from("expenses")
    .select("date, amount, category, source")
    .eq("business_id", business.id)
    .gte("date", minDate)
    .limit(2000);

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
    // CAC — три варианта для свайп-карточки на дашборде: только Meta Ads,
    // только Google Ads, и общий (сумма обеих). Null — если у конкретного
    // источника не было расходов в этот день (нет данных, не "$0").
    row.cac = extra.advertising > 0 && row.orders > 0 ? Number((extra.advertising / row.orders).toFixed(2)) : null;
    row.cacMeta = extra.meta_ads > 0 && row.orders > 0 ? Number((extra.meta_ads / row.orders).toFixed(2)) : null;
    row.cacGoogle = extra.google_ads > 0 && row.orders > 0 ? Number((extra.google_ads / row.orders).toFixed(2)) : null;
  }

  return Response.json({ hasData: true, rows });
}