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

const MIN_DAYS_ABSOLUTE = 3; // меньше — вообще не показываем прогноз
const MIN_DAYS_FULL_CONFIDENCE = 14; // с этого порога — обычная уверенность

// Прогноз должен быть "снимком на сутки": одинаковый на всех устройствах
// в течение одного календарного дня (UTC) и обновляющийся ровно раз в
// день — а не при каждом открытии дашборда. today() ниже — единственная
// точка правды о "текущем дне" для кэша.
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

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
    .order("created_at", { ascending: true })
    .limit(1)
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

  const system = `You are a financial analyst writing a useful forecast summary for RIVANT, an e-commerce analytics dashboard. Respond ONLY in ${langName}, 5-7 sentences, plain factual tone (no hype, no exclamation marks).

Hard rules:
- Use ONLY the numbers given to you below. Never invent revenue figures, seasonality, holidays, or market events not present in the data.
- All monetary figures given to you are already in ${currencyLabel} — use that currency and its symbol (${currencySymbol}) consistently, never mention or convert to any other currency.
- The forecast horizon is exactly ${stats.horizonDays} days — refer to that horizon only, never mention any other number of days for the projection.
- Lead with the business forecast: expected revenue, expected expenses, and the direction of the revenue trend.
- Explain what the trend means for planning and include one practical next step. The advice must be grounded in the supplied figures: for example, monitor sales and costs, revise the plan if actual results diverge, or be cautious with discretionary spending when the trend is negative. Do not suggest specific campaigns, channels, budgets, or causes that are not in the data.
- Put the data source and calculation method in one brief final sentence.
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

function hasExpectedLanguage(text: string, language: string): boolean {
  if (!text) return false;
  if (language === "UA") return /[іїєґІЇЄҐ]/.test(text);
  if (language === "DE") return /[äöüßÄÖÜ]/.test(text) || /\b(und|der|die|das|ist)\b/i.test(text);
  return /\b(the|and|with|forecast|revenue|expenses)\b/i.test(text);
}

function localizedFallbackExplanation(
  language: string,
  currency: Currency,
  stats: { days: number; horizonDays: number; dailyGrowthPct: number; revenueHorizon: number; expensesHorizon: number; confidence: number }
): string {
  const symbol = currency === "EUR" ? "€" : "$";
  const revenue = Math.round(convertAmount(stats.revenueHorizon, currency)).toLocaleString();
  const expenses = Math.round(convertAmount(stats.expensesHorizon, currency)).toLocaleString();
  const trend = Math.abs(stats.dailyGrowthPct).toFixed(1);
  if (language === "UA") {
    return `На наступні ${stats.horizonDays} днів очікувана виручка становить близько ${symbol}${revenue}, а витрати — близько ${symbol}${expenses}. Денний тренд виручки ${stats.dailyGrowthPct >= 0 ? "зростає" : "знижується"} приблизно на ${trend}%, тому прогноз варто врахувати в плані продажів і витрат. ${stats.dailyGrowthPct >= 0 ? "За зростаючого тренду контролюйте, щоб витрати не випереджали фактичну виручку." : "За спадного тренду варто обережно планувати необов’язкові витрати та регулярно звіряти їх із фактичними продажами."} Перевіряйте фактичні показники протягом періоду й оновлюйте план, якщо вони суттєво відхиляються від цього сценарію. Надійність оцінки — ${stats.confidence}%: це орієнтир для планування, а не гарантія. Прогноз сформовано за ${stats.days} днями фактичних даних із підключених синхронізованих джерел, методом аналізу щоденної виручки та витрат.`;
  }
  if (language === "DE") {
    return `Für die nächsten ${stats.horizonDays} Tage werden etwa ${symbol}${revenue} Umsatz und ${symbol}${expenses} Ausgaben erwartet. Der tägliche Umsatztrend ${stats.dailyGrowthPct >= 0 ? "steigt" : "sinkt"} um etwa ${trend}%, was bei der Verkaufs- und Kostenplanung berücksichtigt werden sollte. Prüfen Sie die tatsächlichen Ergebnisse regelmäßig und passen Sie den Plan bei deutlichen Abweichungen an. Die Zuverlässigkeit beträgt ${stats.confidence}% und ist ein Planungswert, keine Garantie. Die Prognose basiert auf ${stats.days} Tagen synchronisierter Daten aus verbundenen Quellen.`;
  }
  return `For the next ${stats.horizonDays} days, expected revenue is about ${symbol}${revenue} and expenses are about ${symbol}${expenses}. Daily revenue is ${stats.dailyGrowthPct >= 0 ? "rising" : "declining"} by about ${trend}%, which should inform sales and cost planning. Review actual results regularly and adjust the plan if they materially differ from this scenario. Confidence is ${stats.confidence}%, so this is a planning guide rather than a guarantee. The forecast uses ${stats.days} days of synchronized data from connected sources.`;
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

  // "Впевненість" — это НЕ R² линейной регрессии. R² меряет, насколько
  // ровно ложится ПРЯМАЯ линия на дневную выручку — а у любого живого
  // бизнеса выручка скачет день ко дню (будни/выходные, случайный крупный
  // заказ), поэтому R² почти всегда низкий ДАЖЕ при куче надёжных данных.
  // Показывать это клиенту как "Confidence: 2%" выглядит как "инструмент
  // сломан", хотя на самом деле это просто нормальное свойство любой
  // реальной выручки — 14 дней надёжных данных не становятся "неувереннее"
  // только потому что кривая не идеально прямая. Настоящее "чему я могу
  // доверять" в прогнозе — это КОЛИЧЕСТВО накопленных данных: чем больше
  // дней истории, тем меньше на прогноз влияет один случайный день.
  // R² остаётся в промпте для ИИ-объяснения (там уместно упомянуть "тренд
  // предсказывает не идеально") — просто не выносится в заголовочную цифру.
  const confidence =
    days >= MIN_DAYS_FULL_CONFIDENCE
      ? Math.min(95, 60 + (days - MIN_DAYS_FULL_CONFIDENCE))
      : Math.round((days / MIN_DAYS_FULL_CONFIDENCE) * 60);

  const forecastNumbers: Record<string, unknown> = {
    sufficient: true as const,
    days,
    tier,
    horizonDays,
    dailyGrowthPct,
    marginSlope: marginReg.slope,
    confidence,
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

  // Кэш forecast_cache — см. комментарий ниже про схему "ряд на каждую
  // комбинацию язык+валюта+горизонт" (было по-другому, чинили дважды).
  const cacheLanguageKey = `v3::${language}::${horizonDays}::${currency}`;
  const { data: cachedRows, error: cacheReadErr } = await admin
    .from("forecast_cache")
    .select("id, days, language, explanation, numbers, generated_at")
    .eq("business_id", businessId)
    .order("generated_at", { ascending: false });

  if (cacheReadErr) {
    console.error("forecast_cache read error:", cacheReadErr);
  }

  // ВАЖНО: раньше здесь брался ПРОСТО самый свежий ряд (cachedRows[0]) —
  // независимо от его языка/валюты — и именно ЕГО потом обновляли ниже.
  // Из-за этого таблица фактически работала как ОДИН слот на бизнес, а не
  // как кэш "на каждую комбинацию язык+валюта+горизонт свой ряд": если два
  // запроса с разным language (например, UA с телефона и случайный/устаревший
  // EN с ноута, ещё не подхвативший профиль) прилетали близко по времени,
  // тот, что дозаписывался в базу ПОСЛЕДНИМ, "побеждал" и для другого языка
  // тоже — следующий UA-запрос читал устаревший EN-ряд как "самый свежий",
  // видел совпадение по generated_at=сегодня, но language не совпадал, поэтому
  // перегенерировал заново (это спасало КОНКРЕТНЫЙ ответ), однако сам EN-ряд
  // после этого снова становился "самым свежим" в таблице и ждал следующего
  // клиента, который случайно придёт с EN и опять всё перезапишет — race
  // на несколько запросов вместо одного стабильного значения. Теперь ищем
  // ряд СРАЗУ с нужным language (=cacheLanguageKey) — у каждой комбинации
  // язык+валюта+горизонт своя строка, которую больше никто другой не трогает.
  const cached = (cachedRows || []).find((r) => r.language === cacheLanguageKey) || null;
  // Лишние дублирующиеся строки (и старый баг "без constraint", и НЕАКТУАЛЬНЫЕ
  // ряды других language/currency старше суток) — подчищаем, чтобы таблица не
  // росла бесконечно вспять для аккаунта, который часто переключает язык/валюту.
  const staleIds = (cachedRows || [])
    .filter((r) => r.id !== cached?.id)
    .filter((r) => r.language !== cacheLanguageKey || new Date(r.generated_at).toISOString().slice(0, 10) !== todayUTC())
    .map((r) => r.id);
  if (staleIds.length) {
    await admin.from("forecast_cache").delete().in("id", staleIds);
  }

  // Прогноз — снимок на календарный день (UTC), а не "живой" пересчёт на
  // каждый запрос. Раньше кэшировался только текст объяснения (на 6 часов),
  // а сами цифры (revenueHorizon/expensesHorizon/dailyGrowthPct и т.д.)
  // считались заново при КАЖДОМ открытии дашборда прямо из metrics_computed.
  // Строка "сегодня" в metrics_computed продолжает получать выручку по
  // мере поступления оплат в течение дня, поэтому регрессия по последней
  // точке чуть менялась от захода к заходу — и телефон с ноутом (открытые
  // в разное время того же дня) могли показать разные цифры. Теперь: если
  // есть кэш за СЕГОДНЯ с тем же days/language/horizon/currency — отдаём
  // его как есть, не пересчитывая. Новый снимок считается ровно один раз —
  // при первом открытии дашборда после смены календарного дня (или когда
  // days реально изменился, т.е. пришли новые синхронизированные данные).
  const cacheIsFresh =
    !!cached &&
    cached.days === days &&
    cached.numbers != null &&
    new Date(cached.generated_at).toISOString().slice(0, 10) === todayUTC();

  let explanation: string;
  let numbersToReturn: Record<string, unknown> = forecastNumbers;

  if (cacheIsFresh && hasExpectedLanguage(cached.explanation || "", language)) {
    explanation = cached.explanation;
    numbersToReturn = cached.numbers as Record<string, unknown>;
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
      if (!hasExpectedLanguage(explanation, language)) {
        explanation = localizedFallbackExplanation(language, currency, {
          days,
          horizonDays,
          dailyGrowthPct,
          revenueHorizon,
          expensesHorizon,
          confidence,
        });
      }
    } catch (e) {
      console.error("Forecast explanation generation failed:", e);
      // Честный fallback: не роняем весь ответ, просто без AI-текста.
      explanation = localizedFallbackExplanation(language, currency, {
        days,
        horizonDays,
        dailyGrowthPct,
        revenueHorizon,
        expensesHorizon,
        confidence,
      });
    }
    const cacheRow = {
      business_id: businessId,
      days,
      language: cacheLanguageKey,
      explanation,
      numbers: forecastNumbers,
      generated_at: new Date().toISOString(),
    };
    if (cached?.id) {
      await admin.from("forecast_cache").update(cacheRow).eq("id", cached.id);
    } else {
      await admin.from("forecast_cache").insert(cacheRow);
    }
  }

  return Response.json({ ...numbersToReturn, explanation });
}
