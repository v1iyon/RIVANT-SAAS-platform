// lib/alerts.mjs
//
// Общий движок алертов (вынесен из sync-stripe-core.mjs, чтобы Shopify/Meta Ads/
// Google Ads могли слать такие же полноценные уведомления — с дедупом за 24ч,
// AI-объяснением и языком пользователя — вместо тихого error_logs, который
// пользователь никогда не видит.
//
// ВАЖНО про дедуп: `type` — это и ключ дедупа, и то, что попадает в Risks tab.
// Каждый источник проблемы должен использовать СВОЙ уникальный type (например
// "sync_failure_shopify", а не общий "sync_failure") — иначе падение Shopify
// молча "накроет" уже открытый алерт про Meta Ads и наоборот.
import { createClient } from "@supabase/supabase-js";
import { getSeverityTelegramLabel } from "./severity.js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function sendTelegram(chatId, text) {
  if (!chatId) return;
  await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function sendEmail(to, subject, text) {
  if (!to) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: "RIVANT <onboarding@resend.dev>", to, subject, text }),
  });
}

// Один гнучкий промпт замість окремого шаблону на кожен тип алерту (легше
// підтримувати). facts — компактний опис ситуації англійською (це просто вхідні
// дані для моделі, мова відповіді все одно задається окремо); модель НЕ рахує
// цифри сама, тільки формулює речення з уже готових чисел.
async function generateAlertExplanation(language, facts) {
  const langName = language === "UA" ? "Ukrainian" : language === "DE" ? "German" : "English";
  const system = `You are a financial analyst writing a short alert explanation for RIVANT, an e-commerce analytics dashboard. Respond ONLY in ${langName}, 1-3 sentences, plain factual tone (no hype, no exclamation marks).

Hard rules:
- Use ONLY the facts given below. Never invent numbers, causes, or events not present in the facts.
- End with a short, concrete "check:" suggestion of 1-3 things relevant to this specific situation.
- Output plain text only, no markdown, no headers, no quotes around the sentence.`;

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
        max_tokens: 150,
        system,
        messages: [{ role: "user", content: facts }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API error: ${res.status} — ${await res.text()}`);
    const data = await res.json();
    return data.content?.[0]?.text?.trim() || buildFallbackExplanation(language, facts);
  } catch (err) {
    console.error("Alert AI explanation failed:", err.message);
    return buildFallbackExplanation(language, facts);
  }
}

// Резервне пояснення, коли AI недоступний (rate limit, збій API тощо).
// Раніше в цьому випадку функція повертала null, і користувач отримував
// голий факт без жодного пояснення — саме на це і скаржились. facts вже є
// стислим, по суті сформульованим реченням (його готує сам виклик у
// sync-скрипті), тому як мінімум-життєздатний варіант просто показуємо його
// разом з локалізованою підказкою "що перевірити". Це не такий гладкий текст,
// як від AI, але завжди присутній.
const FALLBACK_CHECK_LINE = {
  UA: "Перевірте: статус інтеграції, останні зміни в кампаніях/каталозі, логи помилок.",
  EN: "Check: integration status, recent campaign/catalog changes, error logs.",
  DE: "Prüfen Sie: Integrationsstatus, aktuelle Kampagnen-/Katalogänderungen, Fehlerprotokolle.",
};
function buildFallbackExplanation(language, facts) {
  const checkLine = FALLBACK_CHECK_LINE[language] || FALLBACK_CHECK_LINE.EN;
  return `${facts} ${checkLine}`;
}

// Дедуп + запись в alerts_log + отправка Telegram/email. Один и той же `type`
// повторно не шле, пока попередній алерт цього типу лишається "open" і йому
// менше 24 годин (sent_at перевіряється явно — без нього дедуп мовчки не працює).
async function sendAlert({ businessId, type, severity, message, aiExplanation, userLang, telegramId, email, emailEnabled }) {
  const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: existing } = await admin
    .from("alerts_log")
    .select("id")
    .eq("business_id", businessId)
    .eq("type", type)
    .eq("status", "open")
    .gte("sent_at", oneDayAgo)
    .limit(1);
  if (existing?.length) return false;

  const { error: insertErr } = await admin.from("alerts_log").insert({
    business_id: businessId,
    type,
    message,
    ai_explanation: aiExplanation || null,
    status: "open",
    severity,
    sent_at: new Date().toISOString(),
  });
  if (insertErr) {
    console.error(`Failed to insert alert ${type} for business ${businessId}:`, insertErr.message);
    return false;
  }

  const severityLabel = getSeverityTelegramLabel(severity, userLang);
  const fullMessage = aiExplanation ? `${severityLabel}\n${message}\n\n${aiExplanation}` : `${severityLabel}\n${message}`;

  if (telegramId) await sendTelegram(telegramId, fullMessage);
  if (emailEnabled && email) await sendEmail(email, "RIVANT Alert", fullMessage);
  return true;
}

// Хелпер: підтягнути telegram_id/email/language бізнесу одним запитом —
// щоб не дублювати цей join у кожному sync-скрипті.
async function getUserContact(userId) {
  const { data: user } = await admin
    .from("users")
    .select("telegram_id, email, email_enabled, language")
    .eq("id", userId)
    .maybeSingle();
  return {
    telegramId: user?.telegram_id || null,
    email: user?.email || null,
    emailEnabled: !!user?.email_enabled,
    userLang: user?.language || "EN",
  };
}

// Спільна логіка для "сьогоднішня сума сильно відрізняється від тижневого середнього" —
// однаково підходить і для рекламних витрат (Meta/Google Ads), і для собівартості/доставки
// (Shopify). minAvg відсікає шум на зовсім маленьких акаунтах (наприклад $2 -> $5 —
// формально +150%, але для бізнесу це ніщо). Повертає null, якщо аномалії нема або
// історії ще замало для порівняння (< 3 днів).
async function detectExpenseAnomaly({
  businessId,
  source,
  category,
  date,
  todayAmount,
  minAvg = 5,
  spikeMultiplier = 1.6,
  dropRatio = 0.15,
}) {
  const sevenDaysAgo = new Date(new Date(date).getTime() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: recentRows } = await admin
    .from("expenses")
    .select("date, amount")
    .eq("business_id", businessId)
    .eq("source", source)
    .eq("category", category)
    .gte("date", sevenDaysAgo)
    .lt("date", date);

  if (!recentRows || recentRows.length < 3) return null;
  const avg = recentRows.reduce((s, r) => s + Number(r.amount), 0) / recentRows.length;
  if (avg < minAvg) return null;

  if (todayAmount <= avg * dropRatio) {
    return { kind: "drop", pct: Math.round((1 - todayAmount / avg) * 100), avg, today: todayAmount };
  }
  if (todayAmount >= avg * spikeMultiplier) {
    return { kind: "spike", pct: Math.round((todayAmount / avg - 1) * 100), avg, today: todayAmount };
  }
  return null;
}

// CAC = усі рекламні витрати (Meta + Google Ads разом) за дату / кількість замовлень
// за цю ж дату (з metrics_computed, рахується Stripe-синком). Кросс-джерельна метрика —
// тому не прив'язана до конкретного провайдера, викликається і з Meta, і з Google Ads
// sync (дедуп у sendAlert все одно не дасть заалертити двічі).
async function detectCacAnomaly({ businessId, date }) {
  const { data: metricsRow } = await admin
    .from("metrics_computed")
    .select("orders")
    .eq("business_id", businessId)
    .eq("date", date)
    .maybeSingle();
  if (!metricsRow?.orders) return null; // ще нема замовлень за цю дату (Stripe синкається окремо)

  const { data: adRows } = await admin
    .from("expenses")
    .select("amount")
    .eq("business_id", businessId)
    .eq("category", "advertising")
    .eq("date", date);
  const totalSpend = (adRows || []).reduce((s, r) => s + Number(r.amount), 0);
  if (totalSpend <= 0) return null;
  const cacToday = totalSpend / metricsRow.orders;

  const sevenDaysAgo = new Date(new Date(date).getTime() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: recentMetrics } = await admin
    .from("metrics_computed")
    .select("date, orders")
    .eq("business_id", businessId)
    .gte("date", sevenDaysAgo)
    .lt("date", date);
  if (!recentMetrics || recentMetrics.length < 3) return null;

  const recentCacs = [];
  for (const m of recentMetrics) {
    if (!m.orders) continue;
    const { data: rows } = await admin
      .from("expenses")
      .select("amount")
      .eq("business_id", businessId)
      .eq("category", "advertising")
      .eq("date", m.date);
    const spend = (rows || []).reduce((s, r) => s + Number(r.amount), 0);
    if (spend > 0) recentCacs.push(spend / m.orders);
  }
  if (recentCacs.length < 3) return null;

  const avgCac = recentCacs.reduce((a, b) => a + b, 0) / recentCacs.length;
  if (avgCac <= 0) return null;
  const changePct = ((cacToday - avgCac) / avgCac) * 100;
  if (changePct >= 40) {
    return { pct: Math.round(changePct), avgCac, cacToday, orders: metricsRow.orders, totalSpend };
  }
  return null;
}

export { sendAlert, getUserContact, generateAlertExplanation, detectExpenseAnomaly, detectCacAnomaly };
