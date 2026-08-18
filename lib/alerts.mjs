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
// ВАЖЛИВО: раніше тут `facts` (завжди англійською — це просто вхідні дані
// для моделі, а не готовий для показу текст) приклеювався напряму до
// локалізованого checkLine. Результат: користувач бачив, наприклад,
// український SYNC_FAILURE_MESSAGE + суцільний англійський абзац +
// знову українську підказку — саме той "наполовину англійською, наполовину
// українською" алерт, на який скаржились. Тепер fallback-пояснення ЗАВЖДИ
// повністю одномовне: тільки локалізований checkLine, без сирих facts.
const FALLBACK_CHECK_LINE = {
  UA: "Перевірте: статус інтеграції, останні зміни в кампаніях/каталозі, логи помилок.",
  EN: "Check: integration status, recent campaign/catalog changes, error logs.",
  DE: "Prüfen Sie: Integrationsstatus, aktuelle Kampagnen-/Katalogänderungen, Fehlerprotokolle.",
};
function buildFallbackExplanation(language, _facts) {
  return FALLBACK_CHECK_LINE[language] || FALLBACK_CHECK_LINE.EN;
}

// Технічна деталь (сира помилка від зовнішнього API, вона завжди
// англійською і перекладати її небезпечно — можна спотворити суть)
// показується ОКРЕМИМ, явно підписаним рядком, а не вклеюється всередину
// локалізованого речення. Так завжди видно, де закінчується переклад і
// починається сирий текст помилки — замість непомітного змішування мов.
const TECH_DETAIL_LABEL = {
  UA: "Технічна деталь",
  EN: "Technical detail",
  DE: "Technisches Detail",
};
function formatTechnicalDetail(language, reason) {
  if (!reason) return "";
  const label = TECH_DETAIL_LABEL[language] || TECH_DETAIL_LABEL.EN;
  return `\n\n${label}: ${reason}`;
}

// Дедуп + запись в alerts_log + отправка Telegram/email. Один и той же `type`
// повторно не шле, пока з моменту останньої відправки не пройшло cooldownHours
// (sent_at перевіряється явно — без нього дедуп мовчки не працює).
//
// ВАЖЛИВО (фікс "щоденного спаму" по low_stock): раніше тут був ще
// .eq("status", "open"), тобто cooldown фактично діяв лише поки алерт
// лишався відкритим. Але власник закриває картку в "Ризики" (кнопка X /
// "Очистити всі" -> PATCH /api/alerts -> status: "resolved") САМЕ тому, що
// вже побачив проблему й розібрався (замовив товар і т.д.) — а не тому, що
// вона зникла. Щойно алерт ставав "resolved", dedup-запит його більше не
// бачив (шукав тільки status=open) і на наступному ж синку (раз на годину,
// див. .github/workflows/sync-stripe.yml) той самий товар відправлявся
// заново, ігноруючи cooldownHours: 24*7 з scripts/shopify-sync.mjs — звідси
// й "приходить щодня" замість раз на тиждень. Тепер cooldown per-type
// (per-товар для low_stock_shopify_<variant_id>) діє незалежно від того,
// resolved алерт чи ні: власник може закривати картку скільки завгодно —
// нове сповіщення про ЦЕЙ САМИЙ товар прийде не раніше ніж через
// cooldownHours з моменту попередньої відправки.
// Вынесено из sendAlert(), чтобы вызывающий код мог дёшево проверить дедуп
// ДО дорогих вычислений (например, AI-объяснения через Anthropic API) —
// раньше sync-stripe-core.mjs держал для этого свою отдельную ручную
// копию запроса (с багом: фильтровала ещё и по status="open", из-за чего
// resolved-алерт переставал защищать от повторной отправки в течение
// cooldown). Теперь единственный источник правды для "отправляли ли этот
// type за последние cooldownHours" — здесь, и sendAlert() тоже его использует.
async function hasRecentAlert(businessId, type, cooldownHours = 24) {
  const cooldownStart = new Date(Date.now() - cooldownHours * 3600 * 1000).toISOString();
  const { data: existing } = await admin
    .from("alerts_log")
    .select("id")
    .eq("business_id", businessId)
    .eq("type", type)
    .gte("sent_at", cooldownStart)
    .limit(1);
  return Boolean(existing?.length);
}

async function sendAlert({ businessId, type, severity, message, aiExplanation, userLang, telegramId, email, emailEnabled, cooldownHours = 24 }) {
  if (await hasRecentAlert(businessId, type, cooldownHours)) return false;

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
    .select("telegram_id, email, email_enabled, push_enabled, language")
    .eq("id", userId)
    .maybeSingle();
  return {
    // push_enabled раньше вообще не читался и не учитывался — sendAlert слал
    // в Telegram всем, у кого просто есть telegram_id, независимо от тумблера
    // "уведомления" в кабинете (app/api/notification-prefs). Тумблер писался
    // в базу, но ни на что не влиял. По умолчанию true — как и в самом API
    // notification-prefs, чтобы не отключить всем существующим пользователям
    // уведомления задним числом только потому, что поле раньше не выставлялось.
    telegramId: user?.push_enabled === false ? null : user?.telegram_id || null,
    email: user?.email || null,
    emailEnabled: !!user?.email_enabled,
    userLang: user?.language || "EN",
  };
}

// Множник чутливості сповіщень — власник обирає в Settings ("Чутливість
// сповіщень": низька/звичайна/висока). Раніше пороги (>20% для revenue_drop,
// >=40% для CAC-спайку і т.д.) були одними й тими самими константами для
// всіх — великому бізнесу з природними коливаннями ±15%/день це створювало
// шум, маленькому — навпаки, пропускало реальні проблеми.
// > 1 = поріг ВИЩИЙ (потрібна сильніша аномалія, менше сповіщень — "low");
// < 1 = поріг НИЖЧИЙ (реагує навіть на невеликі зміни — "high").
// Один спільний множник для revenue/CAC/ad spend/COGS/доставки — щоб "висока
// чутливість" означала одне й те саме, в якому б sync-скрипті вона не
// застосовувалась, а не набір непов'язаних чисел у кожному файлі.
const SENSITIVITY_MULTIPLIER = { low: 1.5, normal: 1, high: 0.6 };

function resolveSensitivityMultiplier(sensitivity) {
  return SENSITIVITY_MULTIPLIER[sensitivity] || SENSITIVITY_MULTIPLIER.normal;
}

// Один запит замість дублювання .from("businesses").select("alert_sensitivity")
// у кожному sync-скрипті (той самий принцип, що вже застосований у
// lib/get-primary-business.ts) — і єдине місце, де невідоме/відсутнє
// значення в БД (ще не заповнена колонка, або хтось руками записав сміття)
// тихо стає "normal", а не ламає синк.
async function getAlertSensitivity(businessId) {
  const { data } = await admin
    .from("businesses")
    .select("alert_sensitivity")
    .eq("id", businessId)
    .maybeSingle();
  return resolveSensitivityMultiplier(data?.alert_sensitivity);
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
  sensitivityMultiplier = 1,
}) {
  // "low" (multiplier 1.5) розсовує пороги в обидва боки — спайк має бути
  // ще більшим (spikeMultiplier росте), а падіння — ще глибшим (dropRatio
  // падає, тобто today має стати ще меншим за avg, щоб спрацювати).
  // "high" (0.6) робить навпаки — обидва пороги легше перетнути.
  const effectiveSpikeMultiplier = 1 + (spikeMultiplier - 1) * sensitivityMultiplier;
  const effectiveDropRatio = Math.min(0.95, dropRatio / sensitivityMultiplier);

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

  if (todayAmount <= avg * effectiveDropRatio) {
    // Тот же баг, что чинили в revenue_drop (Stripe), только тут по-другому:
    // Meta/Google Ads insights отдают только дневные суммы (без таймстампов
    // отдельных транзакций), поэтому скользящее окно как для Stripe здесь
    // не посчитать. Вместо этого: "падение" за ЕЩЁ НЕ закончившийся
    // календарный день не считаем сигналом, пока не накопилось достаточно
    // часов — иначе каждую ночь "потратили $0 из $80 среднего" выглядело бы
    // как обвал, хотя это просто ранний час дня. Порог 18:00 UTC — грубая
    // эвристика (можно вынести в конфиг по business timezone в будущем);
    // для уже полностью прошедших дат (backfill/повторный прогон) gate не
    // действует — date < сегодня, значит день точно завершён.
    const isToday = date === new Date().toISOString().slice(0, 10);
    const hourUtc = new Date().getUTCHours();
    if (isToday && hourUtc < 18) {
      return null;
    }
    return { kind: "drop", pct: Math.round((1 - todayAmount / avg) * 100), avg, today: todayAmount };
  }
  if (todayAmount >= avg * effectiveSpikeMultiplier) {
    return { kind: "spike", pct: Math.round((todayAmount / avg - 1) * 100), avg, today: todayAmount };
  }
  return null;
}

// CAC = усі рекламні витрати (Meta + Google Ads разом) за дату / кількість замовлень
// за цю ж дату (з metrics_computed, рахується Stripe-синком). Кросс-джерельна метрика —
// тому не прив'язана до конкретного провайдера, викликається і з Meta, і з Google Ads
// sync (дедуп у sendAlert все одно не дасть заалертити двічі).
async function detectCacAnomaly({ businessId, date, sensitivityMultiplier = 1 }) {
  // Базовий поріг 40% масштабується так само, як revenue_drop нижче —
  // "low" піднімає його (потрібен сильніший стрибок CAC), "high" знижує.
  const effectiveThresholdPct = 40 * sensitivityMultiplier;
  const { data: metricsRow } = await admin
    .from("metrics_computed")
    .select("orders")
    .eq("business_id", businessId)
    .eq("date", date)
    .maybeSingle();
  if (!metricsRow?.orders) return null; // ще нема замовлень за цю дату (Stripe синкається окремо)
  // На 1-2 замовленнях CAC — це шум, не сигнал (один випадковий дорогий клік
  // на Meta Ads може дати "CAC +300%" ще о 9 ранку). Той самий принцип, що і
  // для payment_silence: чекаємо, поки набереться достатньо даних.
  if (metricsRow.orders < 3) return null;

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
  if (changePct >= effectiveThresholdPct) {
    return { pct: Math.round(changePct), avgCac, cacToday, orders: metricsRow.orders, totalSpend };
  }
  return null;
}

// Категорії сповіщень (допуслуга "Сповіщення для команди") — щоб власник
// міг видати бухгалтеру тільки "revenue", маркетологу тільки "marketing",
// логісту тільки "inventory" тощо, замість єдиного on/off перемикача.
// ВАЖЛИВО: тримати список у синку з CHECK-констрейнтом у
// migrations/2026-08-14_team_alert_categories.sql — додав категорію тут,
// онови і констрейнт у БД.
const ALERT_CATEGORIES = ["revenue", "marketing", "inventory", "technical"];

// "Періодичність дайджесту" (Settings) — власник обирає, наскільки часто
// приходить ранковий/вечірній звіт (scripts/daily-reports.mjs). "both" —
// поточна поведінка (два звіти на день), "morning_only" — прибирає вечірній,
// "problems_only" — прибирає сам факт "все стабільно" щодня: звіт (будь-
// якого часу доби) шлеться, тільки якщо реально є що показати (відкриті
// сповіщення вранці / нові сповіщення ввечері). Одне місце істини — і для
// валідації в API (business-profile), і для самого daily-reports.mjs.
const DIGEST_FREQUENCIES = ["both", "morning_only", "problems_only"];

// Явний type -> category. Для типів з динамічним суфіксом (наприклад
// low_stock_shopify_<variant_id>, унікальний на кожен товар — див.
// scripts/shopify-sync.mjs) точного збігу не буде, тому нижче є ще й
// перевірка по префіксу.
const ALERT_TYPE_CATEGORY = {
  revenue_drop: "revenue",
  payment_silence_stripe: "revenue",
  cogs_spike_shopify: "revenue",
  shipping_spike_shopify: "inventory",
  ad_spend_spike_meta_ads: "marketing",
  ad_spend_drop_meta_ads: "marketing",
  ad_spend_spike_google_ads: "marketing",
  ad_spend_drop_google_ads: "marketing",
  cac_spike: "marketing",
  sync_failure_shopify: "technical",
  sync_failure_meta_ads: "technical",
  sync_failure_google_ads: "technical",
};
const ALERT_TYPE_PREFIX_CATEGORY = [{ prefix: "low_stock_shopify_", category: "inventory" }];

// Фолбек навмисно "technical": якщо колись з'явиться новий type, про який цю
// мапу забудуть оновити, краще щоб його бачив власник/технічно-обізнаний
// учасник команди, ніж щоб він взагалі нікому не потрапив на очі.
function getAlertCategory(type) {
  if (ALERT_TYPE_CATEGORY[type]) return ALERT_TYPE_CATEGORY[type];
  const byPrefix = ALERT_TYPE_PREFIX_CATEGORY.find((r) => type.startsWith(r.prefix));
  return byPrefix ? byPrefix.category : "technical";
}

// Активні учасники команди для бізнесу (допуслуга "Сповіщення для команди").
// Повертає [] якщо підписка неактивна/протермінована — навіть якщо рядки в
// team_members лишились, sendAlertToBusiness нижче їх просто не використає.
// Повертає весь рядок (не тільки telegram_id), бо викликачу потрібні
// categories, щоб відфільтрувати, кому конкретно слати цей алерт.
async function getTeamContacts(businessId) {
  const { data: addon } = await admin
    .from("addon_subscriptions")
    .select("status, current_period_end")
    .eq("business_id", businessId)
    .eq("addon_type", "team_alerts")
    .maybeSingle();

  if (!addon || addon.status !== "active" || new Date(addon.current_period_end) < new Date()) return [];

  const { data: members } = await admin
    .from("team_members")
    .select("telegram_id, categories")
    .eq("business_id", businessId)
    .eq("status", "active");

  return members || [];
}

// Отдельный дедуп для команды (business_id + telegram_id + type) — см.
// комментарий к таблице team_alert_deliveries в
// supabase/migrations/0002_team_alert_dedup.sql. Возвращает id тех
// получателей из candidateIds, кому этот type НЕ отправлялся в последние
// cooldownHours.
async function filterUnnotifiedRecipients(businessId, candidateIds, type, cooldownHours) {
  if (!candidateIds.length) return [];
  const cooldownStart = new Date(Date.now() - cooldownHours * 3600 * 1000).toISOString();
  const { data: recent } = await admin
    .from("team_alert_deliveries")
    .select("telegram_id")
    .eq("business_id", businessId)
    .eq("type", type)
    .in("telegram_id", candidateIds)
    .gte("sent_at", cooldownStart);
  const alreadyNotified = new Set((recent || []).map((r) => r.telegram_id));
  return candidateIds.filter((id) => !alreadyNotified.has(id));
}

// Обгортка над sendAlert: шле власнику + fan-out учасникам команди, у яких
// у categories є категорія цього конкретного алерту.
//
// ВАЖЛИВО: дедуп власника (в alerts_log, за business_id+type) і дедуп
// команди (в team_alert_deliveries, за business_id+telegram_id+type) —
// ДВА НЕЗАЛЕЖНИХ дедупи. Раніше рассилка команді повністю залежала від
// того, чи sendAlert() щойно відправив власнику: якщо ні (спрацював його
// дедуп по type за останні 24 години) — команда взагалі нічого не
// отримувала, навіть якщо конкретний учасник команди це повідомлення ще
// ЖОДНОГО РАЗУ не бачив (наприклад, підключив допуслугу "Сповіщення для
// команди" або доданий у команду вже ПІСЛЯ того, як алерт пішов власнику в
// поточному вікні). Дедуп мав захищати конкретного отримувача від
// повторної відправки, а не одного отримувача (власника) від усіх інших.
// Тепер fan-out команді виконується завжди при реальному спрацюванні
// алерту (незалежно від delivered), а від спаму кожного учасника захищає
// його ВЛАСНИЙ дедуп по (business_id, telegram_id, type).
async function sendAlertToBusiness(businessId, ownerContact, alertParams) {
  const cooldownHours = alertParams.cooldownHours ?? 24;
  const delivered = await sendAlert({ businessId, ...ownerContact, ...alertParams });

  const members = await getTeamContacts(businessId);
  if (!members.length) return delivered;

  const category = getAlertCategory(alertParams.type);
  const inCategory = members.filter((m) => (m.categories || ALERT_CATEGORIES).includes(category));
  if (!inCategory.length) return delivered;

  const candidateIds = inCategory.map((m) => m.telegram_id).filter(Boolean);
  const recipientIds = await filterUnnotifiedRecipients(businessId, candidateIds, alertParams.type, cooldownHours);
  if (!recipientIds.length) return delivered;

  const severityLabel = getSeverityTelegramLabel(alertParams.severity, ownerContact.userLang);
  const fullMessage = alertParams.aiExplanation
    ? `${severityLabel}\n${alertParams.message}\n\n${alertParams.aiExplanation}`
    : `${severityLabel}\n${alertParams.message}`;

  await Promise.all(recipientIds.map((telegramId) => sendTelegram(telegramId, fullMessage)));

  const { error: deliveryLogErr } = await admin.from("team_alert_deliveries").insert(
    recipientIds.map((telegramId) => ({ business_id: businessId, telegram_id: telegramId, type: alertParams.type }))
  );
  if (deliveryLogErr) {
    console.error(`Failed to record team_alert_deliveries for business ${businessId}:`, deliveryLogErr.message);
  }

  return delivered;
}

// Ранковий і вечірній звіт — це НЕ алерти про проблему (немає порогів,
// немає ризику хибних спрацьовувань), а планові інформаційні зведення.
// Тому не проходять через sendAlert (без дедупу за типом "аномалія") —
// власна логіка "чи вже слали сьогодні" в scripts/daily-reports.mjs.
const MORNING_REPORT_MESSAGE = {
  UA: (name, revenue, marginPct, openCount) =>
    `Доброго ранку! 🏢\nВчорашній дохід "${name}": $${revenue} (маржа ${marginPct}%).\n` +
    (openCount > 0
      ? `⚠️ Наразі відкрито ${openCount} сповіщення — перевірте вкладку "Ризики".`
      : `✅ Активних проблем немає — все стабільно.`),
  EN: (name, revenue, marginPct, openCount) =>
    `Good morning! 🏢\nYesterday's revenue for ${name}: $${revenue} (margin ${marginPct}%).\n` +
    (openCount > 0
      ? `⚠️ ${openCount} alert(s) currently open — check the "Risks" tab.`
      : `✅ No active issues — all stable.`),
  DE: (name, revenue, marginPct, openCount) =>
    `Guten Morgen! 🏢\nGestriger Umsatz von ${name}: $${revenue} (Marge ${marginPct}%).\n` +
    (openCount > 0
      ? `⚠️ Aktuell ${openCount} offene Meldung(en) — siehe Tab "Risiken".`
      : `✅ Keine aktiven Probleme — alles stabil.`),
};

const EVENING_REPORT_MESSAGE = {
  UA: (name, revenue, marginPct, newAlertsCount) =>
    `📊 Підсумок дня "${name}":\nДохід: $${revenue} (маржа ${marginPct}%).\n` +
    (newAlertsCount > 0
      ? `Сьогодні спрацювало сповіщень: ${newAlertsCount} — деталі у вкладці "Ризики".`
      : `Проблем сьогодні не виявлено.`),
  EN: (name, revenue, marginPct, newAlertsCount) =>
    `📊 Daily summary for ${name}:\nRevenue: $${revenue} (margin ${marginPct}%).\n` +
    (newAlertsCount > 0
      ? `${newAlertsCount} alert(s) triggered today — see the "Risks" tab for details.`
      : `No issues detected today.`),
  DE: (name, revenue, marginPct, newAlertsCount) =>
    `📊 Tageszusammenfassung für ${name}:\nUmsatz: $${revenue} (Marge ${marginPct}%).\n` +
    (newAlertsCount > 0
      ? `Heute ${newAlertsCount} Meldung(en) ausgelöst — Details im Tab "Risiken".`
      : `Heute keine Probleme festgestellt.`),
};

// kind: "morning" | "evening". contact — из getUserContact. stats — { revenue, marginPct, count }.
async function sendDailyReport(businessId, businessName, contact, kind, stats) {
  const builder = kind === "morning" ? MORNING_REPORT_MESSAGE : EVENING_REPORT_MESSAGE;
  const buildMessage = builder[contact.userLang] || builder.EN;
  const message = buildMessage(businessName, stats.revenue, stats.marginPct, stats.count);

  if (contact.telegramId) await sendTelegram(contact.telegramId, message);
  if (contact.emailEnabled && contact.email) {
    await sendEmail(contact.email, kind === "morning" ? "RIVANT — ранковий звіт" : "RIVANT — вечірній підсумок", message);
  }

  // Ранковий/вечірній звіт — це виручка + маржа, тобто контент категорії
  // "revenue". Учасникам, яким власник видав, наприклад, тільки "inventory"
  // (логісту), щоденний фінансовий звіт зараз не потрібен — раніше він
  // ішов усім учасникам команди без розбору категорій.
  const members = await getTeamContacts(businessId);
  const recipients = members.filter((m) => (m.categories || ALERT_CATEGORIES).includes("revenue"));
  if (recipients.length) {
    await Promise.all(recipients.map((m) => sendTelegram(m.telegram_id, message)));
  }
}

export {
  sendAlert,
  hasRecentAlert,
  sendAlertToBusiness,
  sendDailyReport,
  getUserContact,
  getTeamContacts,
  generateAlertExplanation,
  detectExpenseAnomaly,
  detectCacAnomaly,
  formatTechnicalDetail,
  getAlertCategory,
  ALERT_CATEGORIES,
  getAlertSensitivity,
  resolveSensitivityMultiplier,
  SENSITIVITY_MULTIPLIER,
  DIGEST_FREQUENCIES,
};
