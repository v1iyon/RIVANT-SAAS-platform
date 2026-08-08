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
  const avgMargin = metrics.reduce((s, m) => s + Number(m.margin_pct), 0) / metrics.length;
  const marginChange = Number(last.margin_pct) - Number(first.margin_pct);

  const topChannel = Object.entries(expensesBySource).sort((a, b) => b[1] - a[1])[0];

  return {
    periodStart: first.date,
    periodEnd: last.date,
    totalRevenue: Number(totalRevenue.toFixed(2)),
    totalOrders,
    avgMarginPct: Number(avgMargin.toFixed(1)),
    marginChangePct: Number(marginChange.toFixed(1)),
    topChannel: topChannel ? { name: topChannel[0], spend: Number(topChannel[1].toFixed(2)) } : null,
  };
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
- Output ${mode === "whatif_analysis" ? "4-6 short bullet-point facts" : "2-3 short bullet-point facts"}, plain text, no markdown headers.`;

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
        max_tokens: 400,
        system,
        messages: [{ role: "user", content: factsText }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
    const data = await res.json();
    return data.content?.[0]?.text?.trim() || null;
  } catch (err) {
    console.error("whatif-report: AI narrative failed:", err.message);
    return null;
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

  return { ok: true, facts, narrative, language };
}

export { buildReport, hasEnoughData };
