// app/api/forecast/route.ts
//
// Гибридный AI-прогноз (Фаза 5):
// - Числа считает детерминированная линейная регрессия по metrics_computed
//   (сервер, не клиент — единственный источник правды).
// - Текстовое объяснение генерирует Anthropic API, но СТРОГО на основе уже
//   посчитанных чисел, которые передаются в промпте как факты. Модель не
//   может "нафантазировать" выручку — она только объясняет тренд словами.
// - Результат кэшируется в forecast_cache на 6 часов, чтобы не дёргать
//   Anthropic API при каждом открытии дашборда (синк всё равно раз в час).
import { createClient } from "@supabase/supabase-js";

// Курс для конвертации сумм в промпте для ИИ-объяснения — сознательно НЕ
// импортируем из lib/currency.tsx: тот файл помечен "use client" и тянет за
// собой React Context/хуки, что при импорте в серверный Route Handler на
// Vercel ломало вызов Anthropic API (падал в catch -> текст ИИ пропадал,
// вместо него рендерился захардкоженный fallback-список трендов). Здесь —
// самодостаточная копия того же курса, без клиентских зависимостей.
const USD_TO_EUR_RATE = 0.867;
type Currency = "USD" | "EUR";
function convertAmount(usdAmount: number, currency: Currency): number {
  return currency === "EUR" ? usdAmount * USD_TO_EUR_RATE : usdAmount;
}

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 часов
const MIN_DAYS_ABSOLUTE = 3; // меньше — вообще не показываем прогноз
const MIN_DAYS_FULL_CONFIDENCE = 14; // с этого порога — обычная уверенность

interface MetricsRow {
  date: string;
  revenue: number;
  cost: number;
  margin_pct: number;
}

async function getBusinessId(email: string) {
  const { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!appUser) return null;
  const { data: business } = await admin
    .from("businesses")
    .select("id")
    .eq("user_id", appUser.id)
    .maybeSingle();
  return business?.id ?? null;
}

// Growth — прогноз на 30 днів, Scale і Trial (повний доступ на час трайлу) — на 90.
// Рахуємо на бекенді, а не ховаємо на фронті, щоб цифри понад ліміт тарифу
// взагалі не потрапляли в responce.
async function getForecastHorizonDays(email: string): Promise<number> {
  const { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!appUser) return 90;
  const { data: sub } = await admin
    .from("subscriptions")
    .select("plan")
    .eq("user_id", appUser.id)
    .maybeSingle();
  return sub?.plan === "growth" ? 30 : 90;
}

async function isStripeConnected(businessId: string) {
  const { data } = await admin
    .from("integrations")
    .select("status")
    .eq("business_id", businessId)
    .eq("provider", "stripe")
    .maybeSingle();
  return data?.status === "connected";
}


function linearRegression(ys: number[]) {
  const n = ys.length;
  if (n === 0) return { slope: 0, intercept: 0, r2: 0 };
  const xs = ys.map((_, i) => i);
  const sumX = xs.reduce((s, x) => s + x, 0);
  const sumY = ys.reduce((s, y) => s + y, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumXX = xs.reduce((s, x) => s + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  const meanY = sumY / n;
  if (denom === 0) return { slope: 0, intercept: meanY, r2: 0 };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const ssTot = ys.reduce((s, y) => s + (y - meanY) ** 2, 0);
  const ssRes = ys.reduce((s, y, i) => s + (y - (intercept + slope * xs[i])) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));
  return { slope, intercept, r2 };
}

function projectTotal(reg: { slope: number; intercept: number }, fromDay: number, days: number) {
  let total = 0;
  for (let i = 0; i < days; i++) {
    total += Math.max(0, reg.intercept + reg.slope * (fromDay + i));
  }
  return total;
}

function getTier(days: number): "insufficient" | "low" | "high" {
  if (days < MIN_DAYS_ABSOLUTE) return "insufficient";
  if (days < MIN_DAYS_FULL_CONFIDENCE) return "low";
  return "high";
}

async function generateExplanation(
  language: string,
  currency: Currency,
  stats: {
    days: number;
    tier: string;
    horizonDays: number;
    dailyGrowthPct: number;
    marginSlope: number;
    revenueHorizon: number;
    expensesHorizon: number;
    r2: number;
  }
) {
  const langName = language === "UA" ? "Ukrainian" : language === "DE" ? "German" : "English";
  const currencyLabel = currency === "EUR" ? "euros (€)" : "US dollars ($)";
  // Числа считаются на бэке в USD (единый источник правды для всех валют),
  // но в текст для Claude подставляем уже сконвертированную сумму в валюте,
  // которую выбрал пользователь — иначе объяснение расходится с цифрами
  // на дашборде, если человек переключился на EUR.
  const revenueHorizonConverted = convertAmount(stats.revenueHorizon, currency);
  const expensesHorizonConverted = convertAmount(stats.expensesHorizon, currency);
  const currencySymbol = currency === "EUR" ? "€" : "$";

  const system = `You are a financial analyst writing a short forecast explanation for RIVANT, an e-commerce analytics dashboard. Respond ONLY in ${langName}, 3-5 sentences, plain factual tone (no hype, no exclamation marks).

Hard rules:
- Use ONLY the numbers given to you below. Never invent revenue figures, seasonality, holidays, or market events not present in the data.
- All monetary figures given to you are already in ${currencyLabel} — use that currency and its symbol (${currencySymbol}) consistently, never mention or convert to any other currency.
- The forecast horizon is exactly ${stats.horizonDays} days — refer to that horizon only, never mention any other number of days for the projection.
- If days < 30, explicitly say seasonality cannot be assessed yet from the available history.
- If tier is "low", clearly state the forecast is preliminary and confidence will improve as more days of data accumulate — do not present the numbers as certain.
- Do not repeat the raw numbers verbatim in a list; weave them into short prose instead.
- Output plain text only, no markdown, no headers.`;

  const user = `Computed statistics (already calculated by linear regression, not by you):
- Days of historical data: ${stats.days}
- Confidence tier: ${stats.tier}
- Forecast horizon: ${stats.horizonDays} days
- Daily revenue trend: ${stats.dailyGrowthPct.toFixed(2)}% per day
- Daily margin trend: ${stats.marginSlope.toFixed(2)} percentage points per day
- Projected revenue over the next ${stats.horizonDays} days: ${currencySymbol}${Math.round(revenueHorizonConverted).toLocaleString()}
- Projected expenses over the next ${stats.horizonDays} days: ${currencySymbol}${Math.round(expensesHorizonConverted).toLocaleString()}
- Regression fit (R²) for revenue: ${Math.round(stats.r2 * 100)}%

Write the explanation now.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Anthropic API error:", res.status, errText);
    throw new Error("Anthropic API request failed");
  }

  const data = await res.json();
  const text = data.content
    ?.map((block: any) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();

  return text || "";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const email = url.searchParams.get("email");
  const language = url.searchParams.get("language") || "EN";
  const currencyParam = url.searchParams.get("currency");
  const currency: Currency = currencyParam === "EUR" ? "EUR" : "USD";


  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const businessId = await getBusinessId(email);
  if (!businessId) return Response.json({ sufficient: false, days: 0 });

  const stripeConnected = await isStripeConnected(businessId);
if (!stripeConnected) return Response.json({ sufficient: false, days: 0, tier: "insufficient" });

  const { data: rows, error } = await admin
    .from("metrics_computed")
    .select("date, revenue, cost, margin_pct")
    .eq("business_id", businessId)
    .order("date", { ascending: true });

  if (error) {
    console.error("GET /api/forecast metrics error:", error);
    return Response.json({ sufficient: false, days: 0 });
  }

  // Подмешиваем реальные расходы (Shopify shipping/cogs, Meta/Google Ads) —
  // без этого cost/margin_pct тут отражают только Stripe-комиссию и прогноз
  // расходится с кабинетом и ботом (одна и та же проблема унификации маржи,
  // формула должна быть одинаковой во всех модулях: кабінет, бот, прогнози, експорт).
  const rawRows = rows || [];
  if (rawRows.length) {
    const minDate = rawRows[0].date;
    const { data: expenseRows } = await admin
      .from("expenses")
      .select("date, amount")
      .eq("business_id", businessId)
      .gte("date", minDate)
      .limit(2000);
    const extraByDate: Record<string, number> = {};
    for (const e of expenseRows || []) {
      extraByDate[e.date] = (extraByDate[e.date] || 0) + (Number(e.amount) || 0);
    }
    for (const r of rawRows) {
      const extra = extraByDate[r.date];
      if (!extra) continue;
      r.cost = Number(r.cost) + extra;
      r.margin_pct = r.revenue > 0 ? Number((((r.revenue - r.cost) / r.revenue) * 100).toFixed(1)) : 0;
    }
  }

  const metricsRows: MetricsRow[] = rawRows;
  const days = metricsRows.length;
  const tier = getTier(days);

  if (tier === "insufficient") {
    return Response.json({ sufficient: false, days, tier });
  }

  const horizonDays = await getForecastHorizonDays(email);

  const revenueReg = linearRegression(metricsRows.map((r) => r.revenue));
  const expensesReg = linearRegression(metricsRows.map((r) => r.cost));
  const marginReg = linearRegression(metricsRows.map((r) => r.margin_pct));
  const fromDay = days;

  const avgRecentRevenue =
    metricsRows.slice(-7).reduce((s, r) => s + r.revenue, 0) / Math.min(7, days);
  const dailyGrowthPct = avgRecentRevenue > 0 ? (revenueReg.slope / avgRecentRevenue) * 100 : 0;

  // Growth (30 днів) отримує тижневу розбивку (7/14/21/30) для міні-графіка
  // на найближчий місяць. Scale/Trial (90 днів) — місячну розбивку (30/60/90),
  // як і раніше. За межі horizonDays цифри в об'єкт відповіді НЕ потрапляють —
  // це ліміт тарифу, а не просто приховане на фронті.
  const revenueHorizon = projectTotal(revenueReg, fromDay, horizonDays);
  const expensesHorizon = projectTotal(expensesReg, fromDay, horizonDays);

  const forecastNumbers: Record<string, unknown> = {
    sufficient: true as const,
    days,
    tier,
    horizonDays,
    dailyGrowthPct,
    marginSlope: marginReg.slope,
    confidence: Math.round(revenueReg.r2 * 100),
  };

  if (horizonDays === 30) {
    forecastNumbers.revenue7 = projectTotal(revenueReg, fromDay, 7);
    forecastNumbers.revenue14 = projectTotal(revenueReg, fromDay, 14);
    forecastNumbers.revenue21 = projectTotal(revenueReg, fromDay, 21);
    forecastNumbers.revenue30 = revenueHorizon;
    forecastNumbers.expenses7 = projectTotal(expensesReg, fromDay, 7);
    forecastNumbers.expenses14 = projectTotal(expensesReg, fromDay, 14);
    forecastNumbers.expenses21 = projectTotal(expensesReg, fromDay, 21);
    forecastNumbers.expenses30 = expensesHorizon;
  } else {
    forecastNumbers.revenue30 = projectTotal(revenueReg, fromDay, 30);
    forecastNumbers.revenue60 = projectTotal(revenueReg, fromDay, 60);
    forecastNumbers.revenue90 = revenueHorizon;
    forecastNumbers.expenses30 = projectTotal(expensesReg, fromDay, 30);
    forecastNumbers.expenses60 = projectTotal(expensesReg, fromDay, 60);
    forecastNumbers.expenses90 = expensesHorizon;
  }

  // Кэш forecast_cache — одна строка на бизнес, поэтому кладём горизонт прямо
  // в поле language ("UA::30"), чтобы апгрейд/даунгрейд тарифа не подсовывал
  // закэшированное объяснение с упоминанием чужого горизонта прогноза.
  // валюту добавляем в ключ, чтобы переключение USD/EUR не подсовывало
  // закэшированное объяснение с суммами не в той валюте.
  const cacheLanguageKey = `${language}::${horizonDays}::${currency}`;
  const { data: cached } = await admin
    .from("forecast_cache")
    .select("days, language, explanation, generated_at")
    .eq("business_id", businessId)
    .maybeSingle();

  const cacheIsFresh =
    cached &&
    cached.days === days &&
    cached.language === cacheLanguageKey &&
    Date.now() - new Date(cached.generated_at).getTime() < CACHE_TTL_MS;

  let explanation: string;

  if (cacheIsFresh) {
    explanation = cached.explanation;
  } else {
    try {
      explanation = await generateExplanation(language, currency, {
        days,
        tier,
        horizonDays,
        dailyGrowthPct,
        marginSlope: marginReg.slope,
        revenueHorizon,
        expensesHorizon,
        r2: revenueReg.r2,
      });
      await admin.from("forecast_cache").upsert({
        business_id: businessId,
        days,
        language: cacheLanguageKey,
        explanation,
        generated_at: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Forecast explanation generation failed:", e);
      // Честный fallback: не роняем весь ответ, просто без AI-текста.
      explanation = "";
    }
  }

  return Response.json({ ...forecastNumbers, explanation });
}