// lib/whatif-report.mjs
//
// Ядро допуслуг "AI-Реконструкція минулого" (whatif_analysis, $199 разово,
// 12 міс. історії) та "AI-Дайджест ефективності" (monthly_digest, $49/міс,
// останні 30 днів). Обидві — той самий движок, різна глибина вибірки.
//
// ВАЖЛИВО (MVP-спрощення): звіт формується як форматований текст, що
// надсилається в Telegram + email, а НЕ бінарний PDF. Для справжнього PDF
// пізніше додайте puppeteer/@react-pdf/renderer в окрему функцію
// renderPdf(reportText) і викликайте її тут перед доставкою.

import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function fetchMetrics(businessId, sinceDate) {
  const { data } = await admin
    .from("metrics_computed")
    .select("date, revenue, cost, margin_pct, orders")
    .eq("business_id", businessId)
    .gte("date", sinceDate)
    .order("date", { ascending: true });
  return data || [];
}

async function fetchExpensesByChannel(businessId, sinceDate) {
  const { data } = await admin
    .from("expenses")
    .select("source, category, amount")
    .eq("business_id", businessId)
    .gte("date", sinceDate);

  const bySource = {};
  for (const row of data || []) {
    bySource[row.source] = (bySource[row.source] || 0) + Number(row.amount);
  }
  return bySource;
}

// Рахуємо факти самі (модель НЕ рахує цифри — тільки формулює речення з
// готових чисел, той самий принцип, що й у lib/alerts.mjs).
function computeFacts(metrics, expensesBySource) {
  if (metrics.length < 5) return null; // недостатньо даних — див. hasEnoughData нижче

  const first = metrics[0];
  const last = metrics[metrics.length - 1];
  const totalRevenue = metrics.reduce((s, m) => s + Number(m.revenue), 0);
  const totalOrders = metrics.reduce((s, m) => s + Number(m.orders), 0);
  const totalCost = metrics.reduce((s, m) => s + Number(m.cost), 0);
  const avgMargin = metrics.reduce((s, m) => s + Number(m.margin_pct), 0) / metrics.length;
  const marginChange = Number(last.margin_pct) - Number(first.margin_pct);
  const bestRevenueDay = metrics.reduce((best, row) => Number(row.revenue) > Number(best.revenue) ? row : best, first);
  const lowestMarginDay = metrics.reduce((worst, row) => Number(row.margin_pct) < Number(worst.margin_pct) ? row : worst, first);
  const midpoint = Math.ceil(metrics.length / 2);
  const firstHalfRevenue = metrics.slice(0, midpoint).reduce((sum, row) => sum + Number(row.revenue), 0);
  const secondHalfRevenue = metrics.slice(midpoint).reduce((sum, row) => sum + Number(row.revenue), 0);
  const revenueMomentumPct = firstHalfRevenue ? ((secondHalfRevenue - firstHalfRevenue) / firstHalfRevenue) * 100 : null;

  const topChannel = Object.entries(expensesBySource).sort((a, b) => b[1] - a[1])[0];

  return {
    periodStart: first.date,
    periodEnd: last.date,
    totalRevenue: Number(totalRevenue.toFixed(2)),
    totalCost: Number(totalCost.toFixed(2)),
    totalProfit: Number((totalRevenue - totalCost).toFixed(2)),
    totalOrders,
    avgOrderValue: totalOrders ? Number((totalRevenue / totalOrders).toFixed(2)) : 0,
    avgMarginPct: Number(avgMargin.toFixed(1)),
    marginChangePct: Number(marginChange.toFixed(1)),
    topChannel: topChannel ? { name: topChannel[0], spend: Number(topChannel[1].toFixed(2)) } : null,
    bestRevenueDay: { date: bestRevenueDay.date, revenue: Number(bestRevenueDay.revenue || 0), orders: Number(bestRevenueDay.orders || 0) },
    lowestMarginDay: { date: lowestMarginDay.date, marginPct: Number(lowestMarginDay.margin_pct || 0) },
    zeroRevenueDays: metrics.filter((row) => Number(row.revenue) === 0).length,
    revenueMomentumPct: revenueMomentumPct == null ? null : Number(revenueMomentumPct.toFixed(1)),
    dataDays: metrics.length,
  };
}

function fallbackNarrativeWhatif(language, facts) {
  const ua = language === "UA";
  const de = language === "DE";
  const money = (value) => `$${Number(value || 0).toLocaleString()}`;
  const heading = (uaText, deText, enText) => ua ? uaText : de ? deText : enText;
  return [
    heading("Підсумок", "Zusammenfassung", "Executive summary"),
    `• ${heading("За", "Im Zeitraum von", "During")} ${facts.periodStart} - ${facts.periodEnd} ${heading("зафіксовано", "wurden", "the business recorded")} ${money(facts.totalRevenue)} ${heading("виручки,", "Umsatz und", "in revenue and")} ${facts.totalOrders} ${heading("замовлень.", "Bestellungen erfasst.", "orders.")}`,
    `• ${heading("Валовий результат після зафіксованих витрат:", "Ergebnis nach erfassten Kosten:", "Result after recorded costs:")} ${money(facts.totalProfit)}; ${heading("середня маржа", "durchschnittliche Marge", "average margin")} ${facts.avgMarginPct}%.`,
    heading("Динаміка виручки та замовлень", "Umsatz- und Bestelldynamik", "Revenue and order dynamics"),
    `• ${heading("Найсильніший день за виручкою:", "Stärkster Umsatztag:", "Highest revenue day:")} ${facts.bestRevenueDay.date} - ${money(facts.bestRevenueDay.revenue)}, ${facts.bestRevenueDay.orders} ${heading("замовлень.", "Bestellungen.", "orders.")}`,
    `• ${heading("Друга половина періоду порівняно з першою:", "Zweite Periodenhälfte gegenüber der ersten:", "Second half versus first half:")} ${facts.revenueMomentumPct == null ? heading("недостатньо даних для порівняння", "zu wenig Daten für einen Vergleich", "not enough data for comparison") : `${facts.revenueMomentumPct >= 0 ? "+" : ""}${facts.revenueMomentumPct}%`}.`,
    `• ${heading("Днів без виручки:", "Tage ohne Umsatz:", "Days without revenue:")} ${facts.zeroRevenueDays} ${heading("із", "von", "of")} ${facts.dataDays}.`,
    heading("Маржа та витрати", "Marge und Kosten", "Margin and costs"),
    `• ${heading("Найнижча зафіксована маржа:", "Niedrigste erfasste Marge:", "Lowest recorded margin:")} ${facts.lowestMarginDay.marginPct}% (${facts.lowestMarginDay.date}).`,
    `• ${heading("Найбільший канал витрат:", "Größter Kostenkanal:", "Largest cost channel:")} ${facts.topChannel ? `${facts.topChannel.name} - ${money(facts.topChannel.spend)}` : heading("даних немає", "keine Daten", "no data")}.`,
    heading("Примітка до реконструкції", "Hinweis zur Rekonstruktion", "Reconstruction note"),
    `• ${heading("Усі висновки сформовані за синхронізованими щоденними даними; AI не вигадує причини, яких немає в даних.", "Alle Erkenntnisse basieren auf synchronisierten Tagesdaten; die KI erfindet keine nicht belegten Ursachen.", "All findings use synchronized daily data; AI does not invent unsupported causes.")}`,
  ].join("\n");
}

// Раніше дайджест при збої AI отримував ТОЙ САМИЙ 4-секційний текст, що й
// реконструкція, включно з заголовком "Примітка до реконструкції" — це і
// плутало клієнтів (звіт за $49/міс раптом каже щось про "реконструкцію").
// Окремий fallback для monthly_digest: без секцій (system-промпт для нього
// й не вимагає заголовків, лише 3-5 буллетів) і без жодних згадок
// "реконструкції".
function fallbackNarrativeDigest(language, facts) {
  const ua = language === "UA";
  const de = language === "DE";
  const money = (value) => `$${Number(value || 0).toLocaleString()}`;
  const heading = (uaText, deText, enText) => ua ? uaText : de ? deText : enText;
  return [
    `• ${heading("За", "Im Zeitraum von", "During")} ${facts.periodStart} - ${facts.periodEnd} ${heading("зафіксовано", "wurden", "the business recorded")} ${money(facts.totalRevenue)} ${heading("виручки,", "Umsatz und", "in revenue and")} ${facts.totalOrders} ${heading("замовлень.", "Bestellungen erfasst.", "orders.")}`,
    `• ${heading("Результат після витрат:", "Ergebnis nach Kosten:", "Result after costs:")} ${money(facts.totalProfit)}; ${heading("середня маржа", "durchschnittliche Marge", "average margin")} ${facts.avgMarginPct}%.`,
    `• ${heading("Найкращий день за виручкою:", "Bester Umsatztag:", "Best revenue day:")} ${facts.bestRevenueDay.date} - ${money(facts.bestRevenueDay.revenue)}.`,
    `• ${heading("Найбільший канал витрат:", "Größter Kostenkanal:", "Largest cost channel:")} ${facts.topChannel ? `${facts.topChannel.name} - ${money(facts.topChannel.spend)}` : heading("даних немає", "keine Daten", "no data")}.`,
    `• ${heading("Днів без виручки за місяць:", "Tage ohne Umsatz im Monat:", "Days without revenue this month:")} ${facts.zeroRevenueDays} ${heading("із", "von", "of")} ${facts.dataDays}.`,
  ].join("\n");
}

function fallbackNarrative(language, facts, mode) {
  return mode === "monthly_digest"
    ? fallbackNarrativeDigest(language, facts)
    : fallbackNarrativeWhatif(language, facts);
}

function hasEnoughData(metrics) {
  return metrics.length >= 5;
}

async function generateNarrative(language, facts, mode) {
  const langName = language === "UA" ? "Ukrainian" : language === "DE" ? "German" : "English";
  const system = `You are a financial analyst writing a factual "what happened" report for RIVANT, an e-commerce analytics dashboard. Respond ONLY in ${langName}.

Hard rules:
- Use ONLY the facts given below. Never invent numbers, causes, or recommendations.
- This is NOT advice — state only what the data shows, no "you should" language.
- For whatif_analysis, write a detailed factual analysis with these plain-text sections: "Executive summary", "Revenue and orders", "Margin and costs", and "Data notes". Include 10-16 concise bullets in total and explain every material change using only supplied values. For monthly_digest, write 3-5 concise factual bullets.
- Formatting is important: put each section heading on its own line with NO leading bullet character. Put every bullet point on its own line starting with "• " (bullet + space). Never combine a heading and a bullet on the same line, and never put two bullets on one line.
- Do not use Markdown formatting (no #, no **, no -) or invent missing facts.`;

  const factsText = JSON.stringify(facts);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: mode === "whatif_analysis" ? 1200 : 500,
        system,
        messages: [{ role: "user", content: factsText }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
    const data = await res.json();
    const text = data.content?.[0]?.text?.trim();
    // Раніше порожній/відсутній text просто повертався як null і "Ключові
    // висновки" в PDF лишались пустими — бо fallback викликався тільки з
    // catch(), а тут (res.ok===true, але вміст порожній) виключення не
    // кидалось. Тепер трактуємо порожню відповідь так само, як помилку.
    if (!text) throw new Error("Anthropic returned empty narrative");
    return text;
  } catch (err) {
    console.error("whatif-report: AI narrative failed:", err.message);
    return fallbackNarrative(language, facts, mode);
  }
}

// mode: "whatif_analysis" (12 міс) | "monthly_digest" (30 днів)
async function buildReport(businessId, mode) {
  const days = mode === "whatif_analysis" ? 365 : 30;
  const sinceDate = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const metrics = await fetchMetrics(businessId, sinceDate);
  if (!hasEnoughData(metrics)) {
    return { ok: false, reason: "not_enough_data" };
  }

  const expensesBySource = await fetchExpensesByChannel(businessId, sinceDate);
  const facts = computeFacts(metrics, expensesBySource);

  const { data: business } = await admin.from("businesses").select("user_id").eq("id", businessId).maybeSingle();
  const { data: user } = business
    ? await admin.from("users").select("language").eq("id", business.user_id).maybeSingle()
    : { data: null };
  const language = user?.language || "EN";

  const narrative = await generateNarrative(language, facts, mode);

  return { ok: true, facts, narrative, language, metrics, expensesBySource };
}

export { buildReport, hasEnoughData };
