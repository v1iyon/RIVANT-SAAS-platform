// scripts/mollie-sync.mjs
//
// Sync-модуль для Mollie. Паттерн 1:1 з paypal-sync.mjs (додатковий канал
// виручки, revenue_mode завжди "add", без чекбокса вибору — Mollie ніколи
// не є системою управління замовленнями/каталогом, тому конфлікту
// replace-режиму тут бути не може).
//
// АВТЕНТИФІКАЦІЯ: на відміну від PayPal (OAuth client_credentials) Mollie
// використовує ОДИН API-ключ (live_xxx / test_xxx) як Bearer-токен напряму
// — той самий підхід, що й Stripe. Тому тут немає окремого config-поля
// client_id: apiKey сам по собі і є секретом, і містить режим (live/test)
// у власному префіксі, як restricted-ключ Stripe.
//
// ПЕРЕВІРЕНО ПРОТИ ОФІЦІЙНОЇ ДОКУМЕНТАЦІЇ MOLLIE (03.09.2026):
//   - GET /v2/payments — курсорна пагінація (?limit=250&from=<paymentId>),
//     НЕ діапазон дат як у PayPal. Список повертається від найновіших до
//     найстаріших, тому для інкрементального синку просто йдемо сторінками,
//     поки не впремось у платіж, старіший за вікно синку, і зупиняємось —
//     не обов'язково вичитувати весь список щогодини.
//   - Платіж має поле "mode": "live" | "test". Тестові платежі (створені
//     під час розробки чекауту клієнтом) НЕ повинні потрапляти у виручку —
//     той самий клас проблеми, що й з тестовим Stripe-ключем
//     (app/api/connect-stripe/route.js, аудит 30.08.2026, знахідка №1).
//     Тут фільтруємо на рівні синку (mode !== "live" → пропуск), а не лише
//     на вході (де приймаємо і live_, і test_ ключі, щоб дозволити клієнту
//     спершу протестувати підключення тестовим ключем).
//   - У Payments API v2 НЕМАЄ комісії Mollie на самому об'єкті платежу
//     (settlementAmount задеприкейчено, а не замінене на fee-поле) —
//     комісії видно лише через Settlements/Balance Transactions API,
//     окремий агрегований звіт, не по кожному платежу. На відміну від
//     paypal-sync.mjs (де fee_amount є прямо в transaction_info) тут
//     ми свідомо НЕ вигадуємо витрати на комісію — пишемо тільки виручку.
//     Track витрат на комісію Mollie — окрема майбутня задача поверх
//     Settlements API, не робимо її тут навмання.
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../lib/crypto.js";
import { logError } from "../lib/log-error.js";
import { sendAlertToBusiness, getUserContact } from "../lib/alerts.mjs";
import { getExchangeRate } from "../lib/fx-rates.mjs";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const MOLLIE_API_BASE = "https://api.mollie.com/v2";

const SYNC_FAILURE_MESSAGE = {
  UA: () => `Не вдалося синхронізувати Mollie`,
  EN: () => `Failed to sync Mollie`,
  DE: () => `Mollie Synchronisierung fehlgeschlagen`,
};

function getSyncFailureReason(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("401") || message.includes("unauthorized")) return "access_denied";
  if (message.includes("403") || message.includes("forbidden")) return "missing_scope";
  if (message.includes("429") || message.includes("rate limit")) return "rate_limited";
  return "connection_failed";
}

const SYNC_FAILURE_EXPLANATION = {
  UA: {
    access_denied: "Перевірте API-ключ Mollie у налаштуваннях інтеграції — можливо, він застарілий, відкликаний або неправильний.",
    missing_scope: "У ключа Mollie немає доступу до Payments API — перевірте права ключа в Mollie Dashboard.",
    rate_limited: "Mollie тимчасово обмежив кількість запитів — синхронізація відновиться на наступному прогоні.",
    connection_failed: "Тимчасова помилка з'єднання з Mollie — перевірте статус інтеграції.",
  },
  EN: {
    access_denied: "Check the Mollie API key in integration settings — it may be outdated, revoked, or incorrect.",
    missing_scope: "This Mollie key doesn't have Payments API access — check the key's permissions in the Mollie Dashboard.",
    rate_limited: "Mollie temporarily rate-limited requests — sync will resume on the next run.",
    connection_failed: "Temporary connection issue with Mollie — check the integration status.",
  },
  DE: {
    access_denied: "Prüfen Sie den Mollie API-Schlüssel in den Integrationseinstellungen — er könnte veraltet, widerrufen oder falsch sein.",
    missing_scope: "Dieser Mollie-Schlüssel hat keinen Zugriff auf die Payments API — prüfen Sie die Berechtigungen im Mollie Dashboard.",
    rate_limited: "Mollie hat Anfragen vorübergehend limitiert — die Synchronisierung wird beim nächsten Lauf fortgesetzt.",
    connection_failed: "Vorübergehendes Verbindungsproblem mit Mollie — prüfen Sie den Integrationsstatus.",
  },
};

// Той самий підхід, що і в paypal-sync.mjs/shopify-sync.mjs — "якому
// календарному дню бізнесу належить ця мить" по ЛОКАЛЬНІЙ таймзоні
// бізнесу, а не UTC.
function localDateStr(tz, atSec) {
  const d = atSec != null ? new Date(atSec * 1000) : new Date();
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC" }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(d);
  }
}

// Курсорна пагінація Mollie: йдемо сторінками (найновіші → найстаріші),
// зупиняємось щойно платіж стає старший за sinceUnix — немає сенсу
// вичитувати весь список щогодини, коли треба лише останні 48г.
// guard=50 сторінок * 250 = 12500 платежів на прогін — з запасом навіть
// для першого backfill.
async function fetchMolliePayments(apiKey, sinceUnix) {
  const all = [];
  let url = `${MOLLIE_API_BASE}/payments?limit=250`;

  for (let guard = 0; guard < 50; guard++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Mollie payments error: ${res.status} ${body}`.slice(0, 300));
    }
    const data = await res.json();
    const payments = data?._embedded?.payments || [];
    if (payments.length === 0) break;

    let hitOlderThanWindow = false;
    for (const p of payments) {
      const createdSec = p.createdAt ? Math.floor(new Date(p.createdAt).getTime() / 1000) : null;
      if (createdSec != null && createdSec < sinceUnix) {
        hitOlderThanWindow = true;
        break;
      }
      all.push(p);
    }
    if (hitOlderThanWindow) break;

    const nextHref = data?._links?.next?.href;
    if (!nextHref) break;
    url = nextHref;
  }
  return all;
}

async function getBusinessUserId(businessId) {
  const { data } = await admin.from("businesses").select("user_id").eq("id", businessId).maybeSingle();
  return data?.user_id ?? null;
}

// Той самий "delta від пам'яті останнього внеску" підхід, що і
// upsertPaypalRevenue у paypal-sync.mjs — інакше при погодинному синку з
// вікном, що перекривається, той самий день додавався б знову і знову.
async function upsertMollieRevenue({ integrationId, integrationConfig, businessId, date, revenue, orders }) {
  const { data: existing } = await admin
    .from("metrics_computed")
    .select("revenue, cost, orders")
    .eq("business_id", businessId)
    .eq("date", date)
    .maybeSingle();

  const memo = { ...(integrationConfig?.mollie_revenue_memo || {}) };
  const prevContribution = Number(memo[date] || 0);
  const prevOrdersContribution = Number(memo[`${date}_orders`] || 0);
  const delta = Number((revenue - prevContribution).toFixed(2));

  const finalRevenue = Number(((existing?.revenue || 0) + delta).toFixed(2));
  const finalOrders = Math.max(0, (existing?.orders || 0) + orders - prevOrdersContribution);

  memo[date] = revenue;
  memo[`${date}_orders`] = orders;
  const cutoff = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  for (const key of Object.keys(memo)) {
    const keyDate = key.replace(/_orders$/, "");
    if (keyDate < cutoff) delete memo[key];
  }

  const cost = existing?.cost || 0;
  const marginPct = finalRevenue > 0 ? Number((((finalRevenue - cost) / finalRevenue) * 100).toFixed(1)) : 0;

  const { error } = await admin.from("metrics_computed").upsert(
    {
      business_id: businessId,
      date,
      revenue: finalRevenue,
      cost,
      margin_pct: marginPct,
      orders: finalOrders,
    },
    { onConflict: "business_id,date" }
  );
  if (error) {
    console.error(`Failed to write Mollie revenue for ${businessId} ${date}:`, error.message);
    return;
  }

  if (integrationId) {
    const nextConfig = { ...(integrationConfig || {}), mollie_revenue_memo: memo };
    const { error: memoErr } = await admin.from("integrations").update({ config: nextConfig }).eq("id", integrationId);
    if (memoErr) console.error(`Failed to persist mollie_revenue_memo for integration ${integrationId}:`, memoErr.message);
    else integrationConfig.mollie_revenue_memo = memo;
  }
}

async function main(businessId, options = {}) {
  const sinceDaysOverride = options.sinceDays || null;

  let query = admin
    .from("integrations")
    .select("id, business_id, api_key_encrypted, config")
    .eq("provider", "mollie")
    .in("status", ["connected", "error"]);
  if (businessId) query = query.eq("business_id", businessId);
  const { data: integrations, error: fetchErr } = await query;

  if (fetchErr) {
    console.error("Failed to fetch mollie integrations:", fetchErr.message);
    await logError({ source: "mollie", message: "Failed to fetch mollie integrations list", details: fetchErr.message });
    return;
  }
  if (!integrations?.length) {
    console.log("No connected Mollie integrations, nothing to sync.");
    return;
  }

  const nowSec = Math.floor(Date.now() / 1000);

  for (const integ of integrations) {
    try {
      const apiKey = decrypt(integ.api_key_encrypted);
      if (!apiKey) throw new Error("Missing Mollie API key");

      const sinceUnix = sinceDaysOverride ? nowSec - sinceDaysOverride * 24 * 3600 : nowSec - 48 * 3600;
      const payments = await fetchMolliePayments(apiKey, sinceUnix);

      const { data: business } = await admin
        .from("businesses")
        .select("id, timezone, currency")
        .eq("id", integ.business_id)
        .maybeSingle();
      if (!business) continue;
      const bizTimezone = business.timezone || "UTC";
      const bizCurrency = (business.currency || "USD").toUpperCase();
      let skippedNoRate = 0;
      let skippedTestMode = 0;

      const byDate = {};
      for (const p of payments) {
        // Тільки успішно оплачені платежі — той самий принцип, що і
        // transaction_status=S у PayPal. "paid" — фінальний успішний
        // статус у Mollie (на відміну від open/pending/canceled/expired/failed).
        if (p.status !== "paid") continue;

        // Тестові платежі (mode: "test") не рахуємо як виручку — той самий
        // клас захисту, що й перевірка rk_live_ у app/api/connect-stripe.
        if (p.mode !== "live") {
          skippedTestMode += 1;
          continue;
        }

        const amount = Number(p.amount?.value);
        if (!Number.isFinite(amount) || amount <= 0) continue;

        const paidAtStr = p.paidAt || p.createdAt;
        const paidSec = paidAtStr ? Math.floor(new Date(paidAtStr).getTime() / 1000) : null;
        if (!paidSec) continue;

        const date = localDateStr(bizTimezone, paidSec);
        const txCurrency = (p.amount?.currency || bizCurrency).toUpperCase();

        let rate = 1;
        if (txCurrency !== bizCurrency) {
          try {
            rate = await getExchangeRate(txCurrency, bizCurrency, date);
          } catch (fxErr) {
            skippedNoRate += 1;
            console.warn(`Mollie business ${integ.business_id}: no FX rate ${txCurrency}->${bizCurrency} for ${date}, skipping one payment:`, fxErr.message);
            continue;
          }
        }

        if (!byDate[date]) byDate[date] = { revenue: 0, orders: 0 };
        byDate[date].revenue += amount * rate;
        byDate[date].orders += 1;
      }

      if (skippedNoRate > 0) {
        console.warn(`Mollie business ${integ.business_id}: ${skippedNoRate} payment(s) skipped — no ECB exchange rate available.`);
      }
      if (skippedTestMode > 0) {
        console.log(`Mollie business ${integ.business_id}: ${skippedTestMode} test-mode payment(s) excluded from revenue.`);
      }

      for (const [date, agg] of Object.entries(byDate)) {
        await upsertMollieRevenue({
          integrationId: integ.id,
          integrationConfig: integ.config || {},
          businessId: integ.business_id,
          date,
          revenue: Number(agg.revenue.toFixed(2)),
          orders: agg.orders,
        });
      }

      const { sync_error_reason: _prevError, ...cleanConfig } = integ.config || {};
      await admin
        .from("integrations")
        .update({ last_synced_at: new Date().toISOString(), status: "connected", config: cleanConfig })
        .eq("id", integ.id);

      console.log(`Mollie synced business ${integ.business_id}: ${Object.keys(byDate).length} day(s)`);
    } catch (err) {
      console.error(`Failed to sync Mollie integration ${integ.id}:`, err.message);
      await logError({
        source: "mollie",
        message: `Sync failed for integration ${integ.id}`,
        details: err.message,
        businessId: integ.business_id,
      });

      const reason = getSyncFailureReason(err);
      await admin
        .from("integrations")
        .update({ status: "error", config: { ...(integ.config || {}), sync_error_reason: reason } })
        .eq("id", integ.id);

      const contact = await getUserContact(await getBusinessUserId(integ.business_id));
      const msg = (SYNC_FAILURE_MESSAGE[contact.userLang] || SYNC_FAILURE_MESSAGE.EN)();
      const explanation = (SYNC_FAILURE_EXPLANATION[contact.userLang] || SYNC_FAILURE_EXPLANATION.EN)[reason];
      await sendAlertToBusiness(integ.business_id, contact, {
        type: "sync_failure_mollie",
        severity: "high",
        message: msg,
        aiExplanation: explanation,
      });
    }
  }
}

export async function runSync(businessId, options = {}) {
  await main(businessId, options);
  return { synced: true, timestamp: new Date().toISOString() };
}
