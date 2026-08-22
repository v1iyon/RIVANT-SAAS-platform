// app/api/metrics/route.ts
import { createClient } from "@supabase/supabase-js";
import { getPrimaryBusinessId } from "@/lib/get-primary-business";
import { requireUser, UnauthorizedError } from "@/lib/require-user";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Джерела виручки — тримати синхронно з lib REVENUE_SOURCE_PROVIDERS у
// app/api/integrations-select/route.js (той самий список, дубльований тут
// навмисно: цей файл — .ts у app/api, той — .js, спільний lib-модуль під
// обидва раніше не заводили; якщо додасте нове джерело виручки — онови
// в обох місцях).
const REVENUE_SOURCE_PROVIDERS = ["stripe", "shopify"];

// Сколько дней истории отдаём по тарифу — держим синхронно с текстом на
// лендинге ("Зберігання історії за 30/90 днів", "Необмежена історія").
// Единственное место в коде, где это должно быть определено — раньше было
// продублировано (и не совпадало) в app/api/metrics_computed/route.js,
// который дашборд вообще не вызывал; этот дублирующий файл удалён.
const HISTORY_DAYS_BY_PLAN: Record<string, number> = {
  trial: 90,
  starter: 30,
  growth: 90,
  scale: 3650, // "неограниченно" на практике = не режем вообще
};
const DEFAULT_HISTORY_DAYS = 30;

// ФІКС: раніше тут був .limit(2000) без .order() — для акаунтів з довгою
// історією (тариф "scale" не ріже історію взагалі, HISTORY_DAYS_BY_PLAN
// вище) кількість рядків у expenses (shipping+cogs+2 рекламних джерела ≈
// до 4 записів/день) реально перевищує 2000 вже за ~1.5 року. Понад ліміт
// рядки мовчки не потрапляли у вибірку (і порядок повернення без order()
// взагалі не гарантований) — прибуток/маржа за частину періоду тихо
// занижували реальні витрати. Пагінація нижче забирає ВСІ рядки за вікно.
async function fetchAllExpenses(businessId: string, sinceDate: string) {
  const all: { date: string; amount: number; category: string | null; source: string | null }[] = [];
  const pageSize = 1000;
  for (let page = 0; page < 100; page++) {
    // safety cap: 100k rows — захист від нескінченного циклу, не реальний ліміт
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
  // email больше не берём из query — раньше это отдавало полный дашборд
  // (выручку, расходы, CAC) чужого бизнеса любому, кто знает email жертвы.
  let email: string;
  try {
    ({ email } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }

  const { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!appUser) return Response.json({ hasData: false, rows: [] });

  const businessId = await getPrimaryBusinessId(admin, appUser.id);
  if (!businessId) return Response.json({ hasData: false, rows: [] });

  // ВАЖЛИВО (фікс під нову тарифну логіку): раніше тут перевірявся ЛИШЕ
  // Stripe — клієнт, який обрав Shopify єдиним джерелом виручки (Starter/
  // Growth тепер дозволяють це, див. integrations-select/route.js), назавжди
  // бачив порожній дашборд навіть після успішного синку: дані вже лежали
  // в metrics_computed (їх пише upsertShopifyRevenue у shopify-sync.mjs),
  // просто цей ґейт про них не знав. Тепер дашборд показує дані, якщо
  // ПІДКЛЮЧЕНЕ будь-яке джерело виручки — Stripe, Shopify, або обидва.
  // Якщо джерело відключають — дашборд відкочується до "як ніби не
  // підключали" тільки тоді, коли відключені ВСІ джерела виручки разом.
  const { data: revenueIntegrations } = await admin
    .from("integrations")
    .select("provider, status")
    .eq("business_id", businessId)
    .in("provider", REVENUE_SOURCE_PROVIDERS)
    .eq("status", "connected");

  if (!revenueIntegrations || revenueIntegrations.length === 0) {
    return Response.json({ hasData: false, rows: [] });
  }

  // Скользящее окно "последние N дней по тарифу" — фильтр по дате, а НЕ
  // limit() после сортировки. С limit(90) после 90+ дней накопленной
  // истории запрос отдавал бы САМЫЕ СТАРЫЕ 90 дней вместо последних —
  // дашборд навсегда залипал бы на старом окне для аккаунтов старше
  // ~3 месяцев. Фильтр по дате сам "едет" вперёд каждый день вместе с
  // "сегодня": самый старый день просто перестаёт попадать в выборку
  // (в базе он остаётся), новый день добавляется — без скачков к нулю.
  const { data: sub } = await admin
    .from("subscriptions")
    .select("plan")
    .eq("user_id", appUser.id)
    .maybeSingle();
  const historyDays = HISTORY_DAYS_BY_PLAN[sub?.plan || ""] ?? DEFAULT_HISTORY_DAYS;
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

  // Подмешиваем реальные расходы из expenses (Shopify shipping, Meta Ads
  // advertising — пишет shopify-sync.mjs / meta-ads-sync.mjs раз в час).
  // Без этого шага expenses копится в базе, но дашборд его никогда не видел.
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
    // CAC — три варианта для свайп-карточки на дашборде: только Meta Ads,
    // только Google Ads, и общий (сумма обеих). Null — если у конкретного
    // источника не было расходов в этот день (нет данных, не "$0").
    row.cac = extra.advertising > 0 && row.orders > 0 ? Number((extra.advertising / row.orders).toFixed(2)) : null;
    row.cacMeta = extra.meta_ads > 0 && row.orders > 0 ? Number((extra.meta_ads / row.orders).toFixed(2)) : null;
    row.cacGoogle = extra.google_ads > 0 && row.orders > 0 ? Number((extra.google_ads / row.orders).toFixed(2)) : null;
  }

  return Response.json({ hasData: true, rows });
}