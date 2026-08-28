// lib/stripe-webhook.mjs
//
// ФІКС (аудит #2, знахідка №9 / перенесено з FINAL A4): цей файл раніше
// НЕ ІСНУВАВ у репозиторії, хоча вже імпортувався в трьох місцях
// (app/api/connect-stripe/route.js, app/api/stripe-disconnect/route.js,
// scripts/sync-stripe-core.mjs) — тобто підключення Stripe віддавало 500
// на кожній спробі, а часовий крон sync-stripe-core.mjs взагалі падав на
// самому імпорті ще ДО обробки хоч одного бізнесу (не лише нових —
// ЖОДЕН Stripe-синк для жодного бізнесу не міг відпрацювати, поки цього
// файлу нема). Коментарі в коді описували фікс, якого не було.
//
// Призначення: реєструє per-business Stripe webhook endpoint В АКАУНТІ
// САМОГО КЛІЄНТА (тим самим restricted key, який він ввів у Settings),
// що вказує на app/api/webhooks/stripe/[businessId]/route.js. Це дає
// майже миттєве (секунди, а не до години) оновлення metrics_computed
// між годинними прогонами sync-stripe-core.mjs, який лишається джерелом
// правди (reconciliation) — вебхук лише "підштовхує" цифру, не замінює
// повний перерахунок.
//
// Best-effort по дизайну: клієнтський restricted key міг бути виданий БЕЗ
// права "Webhook Endpoints: Write" (обмеженіший набір прав, ніж потрібно
// для читання charges). У такому разі просто повертаємо null і НІЧОГО не
// ламаємо — виклики (connect-stripe, self-heal у sync-stripe-core) вже
// написані очікувати null і продовжувати працювати виключно на кроні.

import Stripe from "stripe";

const STRIPE_API_VERSION = "2025-02-24.acacia";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://rivant-os.com").replace(/\/$/, "");

// Той самий набір подій, який реально споживає app/api/webhooks/stripe/[businessId]/route.js —
// тримати список тут і там синхронізованим навмисно (одне джерело правди
// про те, "які події нам взагалі потрібні").
export const STRIPE_WEBHOOK_EVENTS = ["charge.succeeded", "payment_intent.succeeded"];

/**
 * Реєструє (або, якщо вже є з таким самим URL, повторно використовує)
 * webhook endpoint в акаунті клієнта. Викликається при підключенні ключа
 * (connect-stripe) і, раз на добу, як self-heal у sync-stripe-core.mjs
 * для інтеграцій, де перша спроба не вдалась.
 *
 * @param {string} apiKey - клієнтський Stripe restricted key (rk_...)
 * @param {string} businessId
 * @param {(text: string) => string} encryptFn - lib/crypto.js encrypt(), передається ззовні, щоб не тягнути дублюючий ENCRYPTION_KEY-контекст тут
 * @returns {Promise<{ id: string, secretEncrypted: string } | null>}
 */
export async function ensureStripeWebhook(apiKey, businessId, encryptFn) {
  if (!apiKey || !businessId || typeof encryptFn !== "function") return null;

  const stripe = new Stripe(apiKey, { apiVersion: STRIPE_API_VERSION });
  const url = `${SITE_URL}/api/webhooks/stripe/${businessId}`;

  try {
    // Якщо ендпоінт з таким самим URL вже існує (наприклад, повторний
    // виклик self-heal після часткового збою) — не плодимо дублі, а
    // повертаємо null: секрет вже відомий і лежить у config, дублювати
    // ендпоінт без потреби небезпечно (клієнт побачить два вебхуки в
    // своєму Stripe dashboard на один і той самий бізнес).
    const existingList = await stripe.webhookEndpoints.list({ limit: 100 });
    const already = existingList?.data?.find((e) => e.url === url);
    if (already) {
      console.warn(`ensureStripeWebhook: endpoint for business ${businessId} already exists (${already.id}), skipping re-creation`);
      return null;
    }

    const endpoint = await stripe.webhookEndpoints.create({
      url,
      enabled_events: STRIPE_WEBHOOK_EVENTS,
      description: "RIVANT — auto-created for near-real-time metrics (see lib/stripe-webhook.mjs)",
    });

    if (!endpoint?.secret) {
      // Stripe API в деяких режимах (Connect-акаунти клієнта, певні типи
      // ключів) не повертає secret у відповіді на create — без нього
      // неможливо верифікувати підпис вхідних подій. Best-effort: краще
      // не мати вебхука взагалі, ніж мати неверифікований.
      console.warn(`ensureStripeWebhook: created endpoint for business ${businessId} but no secret returned, treating as failed`);
      try { await stripe.webhookEndpoints.del(endpoint.id); } catch { /* best-effort cleanup */ }
      return null;
    }

    return { id: endpoint.id, secretEncrypted: encryptFn(endpoint.secret) };
  } catch (err) {
    // Найчастіша причина — restricted key без права "Webhook Endpoints:
    // Write" (403/permission error). Це очікувана, не критична ситуація:
    // логуємо на рівні warn (не error), щоб не засмічувати error_logs
    // подіями, які не потребують дії людини — гарячий шлях лишається
    // годинний крон.
    console.warn(`ensureStripeWebhook: could not register webhook for business ${businessId}: ${err.message}`);
    return null;
  }
}

/**
 * Видаляє webhook endpoint з акаунту клієнта. Викликається з
 * app/api/stripe-disconnect/route.js — сам виклик вже обгорнутий у
 * try/catch на боці викликача (best-effort: ключ міг бути відкликаний
 * клієнтом вручну до дисконнекту в RIVANT).
 *
 * @param {string} apiKey
 * @param {string} webhookId
 */
export async function deleteStripeWebhook(apiKey, webhookId) {
  if (!apiKey || !webhookId) return;
  const stripe = new Stripe(apiKey, { apiVersion: STRIPE_API_VERSION });
  await stripe.webhookEndpoints.del(webhookId);
}
