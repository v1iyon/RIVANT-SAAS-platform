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
  stats: {
    days: number;
    tier: string;
    dailyGrowthPct: number;
    marginSlope: number;
    revenue90: number;
    expenses90: number;
    r2: number;
  }
) {
  const langName = language === "UA" ? "Ukrainian" : language === "DE" ? "German" : "English";

  const system = `You are a financial analyst writing a short forecast explanation for RIVANT, an e-commerce analytics dashboard. Respond ONLY in ${langName}, 3-5 sentences, plain factual tone (no hype, no exclamation marks).

Hard rules:
- Use ONLY the numbers given to you below. Never invent revenue figures, seasonality, holidays, or market events not present in the data.
- If days < 30, explicitly say seasonality cannot be assessed yet from the available history.
- If tier is "low", clearly state the forecast is preliminary and confidence will improve as more days of data accumulate — do not present the numbers as certain.
- Do not repeat the raw numbers verbatim in a list; weave them into short prose instead.
- Output plain text only, no markdown, no headers.`;

  const user = `Computed statistics (already calculated by linear regression, not by you):
- Days of historical data: ${stats.days}
- Confidence tier: ${stats.tier}
- Daily revenue trend: ${stats.dailyGrowthPct.toFixed(2)}% per day
- Daily margin trend: ${stats.marginSlope.toFixed(2)} percentage points per day
- Projected revenue over next 90 days: $${Math.round(stats.revenue90).toLocaleString()}
- Projected expenses over next 90 days: $${Math.round(stats.expenses90).toLocaleString()}
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

  const metricsRows: MetricsRow[] = rows || [];
  const days = metricsRows.length;
  const tier = getTier(days);

  if (tier === "insufficient") {
    return Response.json({ sufficient: false, days, tier });
  }

  const revenueReg = linearRegression(metricsRows.map((r) => r.revenue));
  const expensesReg = linearRegression(metricsRows.map((r) => r.cost));
  const marginReg = linearRegression(metricsRows.map((r) => r.margin_pct));
  const fromDay = days;

  const revenue30 = projectTotal(revenueReg, fromDay, 30);
  const revenue60 = projectTotal(revenueReg, fromDay, 60);
  const revenue90 = projectTotal(revenueReg, fromDay, 90);
  const expenses30 = projectTotal(expensesReg, fromDay, 30);
  const expenses60 = projectTotal(expensesReg, fromDay, 60);
  const expenses90 = projectTotal(expensesReg, fromDay, 90);

  const avgRecentRevenue =
    metricsRows.slice(-7).reduce((s, r) => s + r.revenue, 0) / Math.min(7, days);
  const dailyGrowthPct = avgRecentRevenue > 0 ? (revenueReg.slope / avgRecentRevenue) * 100 : 0;

  const forecastNumbers = {
    sufficient: true as const,
    days,
    tier,
    revenue30, revenue60, revenue90,
    expenses30, expenses60, expenses90,
    dailyGrowthPct,
    marginSlope: marginReg.slope,
    confidence: Math.round(revenueReg.r2 * 100),
  };

  // Проверяем кэш — не дёргаем Anthropic API, если объяснение свежее и
  // считалось для того же количества дней и того же языка.
  const { data: cached } = await admin
    .from("forecast_cache")
    .select("days, language, explanation, generated_at")
    .eq("business_id", businessId)
    .maybeSingle();

  const cacheIsFresh =
    cached &&
    cached.days === days &&
    cached.language === language &&
    Date.now() - new Date(cached.generated_at).getTime() < CACHE_TTL_MS;

  let explanation: string;

  if (cacheIsFresh) {
    explanation = cached.explanation;
  } else {
    try {
      explanation = await generateExplanation(language, {
        days,
        tier,
        dailyGrowthPct,
        marginSlope: marginReg.slope,
        revenue90,
        expenses90,
        r2: revenueReg.r2,
      });
      await admin.from("forecast_cache").upsert({
        business_id: businessId,
        days,
        language,
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