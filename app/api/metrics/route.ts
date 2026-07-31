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

  const { data: rawRows, error } = await admin
    .from("metrics_computed")
    .select("date, revenue, cost, margin_pct, orders")
    .eq("business_id", business.id)
    .order("date", { ascending: true })
    .limit(90);

  if (error || !rawRows || rawRows.length === 0) {
    return Response.json({ hasData: false, rows: [] });
  }

  // sync-stripe-core.mjs пишет revenue/cost/margin_pct/orders, а не
  // expenses/profit/cac (тех колонок не существует) — считаем производные
  // поля здесь, чтобы фронтенд получал стабильную форму данных.
  // CAC пока нет источника данных (нет интеграции с рекламными кабинетами),
  // поэтому не выдумываем цифру — оставляем null и явно помечаем на фронте.
  const rows = rawRows.map((r) => ({
    date: r.date,
    revenue: Number(r.revenue) || 0,
    expenses: Number(r.cost) || 0,
    profit: Number(r.revenue) - Number(r.cost),
    margin_pct: Number(r.margin_pct) || 0,
    orders: Number(r.orders) || 0,
    cac: null as number | null,
  }));

  return Response.json({ hasData: true, rows });
}