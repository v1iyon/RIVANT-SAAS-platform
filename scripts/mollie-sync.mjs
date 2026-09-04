// scripts/mollie-sync.mjs
//
// Sync-модуль для Mollie. Паттерн 1:1 з paypal-sync.mjs (додатковий канал
// виручки, revenue_mode завжди "add" — Mollie ніколи не є системою
// управління замовленнями/каталогом, тому конфлікту replace-режиму тут
// бути не може).
//
// ДВА КРЕДЕНШЛИ, НЕ ОДИН (03.09.2026, за прямим запитом — "хочу чесні
// комісії, а не оцінку"):
//   1. api_key (live_xxx/test_xxx) — звичайний Payments API, тягне
//      список платежів (GET /v2/payments), той самий підхід, що й раніше.
//   2. advanced_access_token (access_xxx) — ОКРЕМИЙ токен, потрібен для
//      Balance Transactions API (GET /v2/balances/primary/transactions).
//      ПЕРЕВІРЕНО ПРОТИ ОФІЦІЙНОЇ СХЕМИ (docs.mollie.com/reference/
//      list-balance-transactions, 03.09.2026): кожна transaction типу
//      "payment" має поле `deductions` — ТОЧНА сума, знята за ЦЕЙ
//      конкретний платіж (не агрегат за період, не оцінка), і `context.
//      paymentId`, яким вона однозначно зіставляється з платежем зі
//      списку #1. Payments API v2 сам по собі цього поля не має —
//      Advanced access token генерується так само self-service, в Mollie
//      Dashboard → Developers → API access tokens (НЕ OAuth-редирект,
//      той самий принцип, що й Live API key).
//
// Якщо колись знадобиться зробити advanced_access_token необов'язковим
// (дозволити підключення "тільки виручка, без комісій") — просто прибрати
// його з REQUIRED_CONFIG_FIELDS.mollie в connect-integration/route.js і
// зробити fetchMollieFeesByPaymentId() тут no-op, коли токена нема. Наразі
// свідомо зроблено обов'язковим, щоб не видавати оцінку за факт.
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../lib/crypto.js";
import { logError } from "../lib/log-error.js";
import { sendAlertToBusiness, getUserContact } from "../lib/alerts.mjs";
import { getExchangeRate } from "../lib/fx-rates.mjs";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const MOLLIE_API_BASE = "https://api.mollie.com/v2";

// Buffer для запиту balance transactions: Mollie сам пише в доках, що
// швидкі методи (iDEAL) потрапляють у баланс миттєво, а повільні (картка)
// можуть осідати "кілька днів". Вікно виручки (payments) лишається 48г
// як завжди, а вікно balance transactions беремо ширшим — інакше комісія
// за платіж, що щойно осів у баланс через 3 дні після оплати, ніколи не
// потрапить у жоден прогін і назавжди лишиться без витрати.
const FEE_WINDOW_BUFFER_SEC = 5 * 24 * 3600;

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
    access_denied: "Перевірте API-ключ або Advanced access token Mollie у налаштуваннях інтеграції — можливо, один з них застарілий, відкликаний або неправильний.",
    missing_scope: "Advanced access token Mollie не має права balances.read — перегенеруйте токен у Mollie Dashboard з цим правом.",
    rate_limited: "Mollie тимчасово обмежив кількість запитів — синхронізація відновиться на наступному прогоні.",
    connection_failed: "Тимчасова помилка з'єднання з Mollie — перевірте статус інтеграції.",
  },
  EN: {
    access_denied: "Check the Mollie API key or Advanced access token in integration settings — one of them may be outdated, revoked, or incorrect.",
    missing_scope: "The Mollie Advanced access token is missing the balances.read permission — regenerate it in the Mollie Dashboard with that scope.",
    rate_limited: "Mollie temporarily rate-limited requests — sync will resume on the next run.",
    connection_failed: "Temporary connection issue with Mollie — check the integration status.",
  },
  DE: {
    access_denied: "Prüfen Sie den Mollie API-Schlüssel oder den Advanced Access Token in den Integrationseinstellungen — einer davon könnte veraltet, widerrufen oder falsch sein.",
    missing_scope: "Dem Mollie Advanced Access Token fehlt die Berechtigung balances.read — erstellen Sie ihn im Mollie Dashboard mit diesem Scope neu.",
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

// Курсорна пагінація Mollie (Payments API): йдемо сторінками (найновіші →
// найстаріші), зупиняємось щойно платіж стає старший за sinceUnix.
async function fetchMolliePayments(apiKey, sinceUnix) {
  const all = [];
  let url = `${MOLLIE_API_BASE}/payments?limit=250`;

  for (let guard = 0; guard < 50; guard++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
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

// Balance Transactions API: та сама курсорна пагінація, ширше вікно
// (FEE_WINDOW_BUFFER_SEC) — див. коментар вгорі файлу про причину.
// Повертає Map<paymentId, { value: number, currency: string }> — точна
// сума комісії (|deductions.value|) для кожного платежу типу "payment",
// що реально знайшовся в balance transactions.
async function fetchMollieFeesByPaymentId(advancedAccessToken, sinceUnix) {
  const fees = new Map();
  let url = `${MOLLIE_API_BASE}/balances/primary/transactions?limit=250`;
  const windowStart = sinceUnix - FEE_WINDOW_BUFFER_SEC;

  for (let guard = 0; guard < 50; guard++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${advancedAccessToken}` } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Mollie balance transactions error: ${res.status} ${body}`.slice(0, 300));
    }
    const data = await res.json();
    const txs = data?._embedded?.balance_transactions || [];
    if (txs.length === 0) break;

    let hitOlderThanWindow = false;
    for (const tx of txs) {
      const createdSec = tx.createdAt ? Math.floor(new Date(tx.createdAt).getTime() / 1000) : null;
      if (createdSec != null && createdSec < windowStart) {
        hitOlderThanWindow = true;
        break;
      }
      // Тільки type="payment" — успішне надходження коштів. Refund/
      // chargeback/transfer тощо мають власну семантику (гроші йдуть З
      // балансу, не комісія на вхідний платіж) і тут навмисно ігноруються —
      // цей sync-модуль пише лише виручку і комісію процесингу, не повний
      // бухгалтерський журнал руху балансу.
      if (tx.type !== "payment") continue;
      const paymentId = tx.context?.paymentId;
      if (!paymentId) continue;
      const deductionValue = Number(tx.deductions?.value);
      if (!Number.isFinite(deductionValue) || deductionValue === 0) continue;
      fees.set(paymentId, {
        value: Math.abs(deductionValue),
        currency: (tx.deductions?.currency || tx.resultAmount?.currency || "EUR").toUpperCase(),
      });
    }
    if (hitOlderThanWindow) break;

    const nextHref = data?._links?.next?.href;
    if (!nextHref) break;
    url = nextHref;
  }
  return fees;
}

async function getBusinessUserId(businessId) {
  const { data } = await admin.from("businesses").select("user_id").eq("id", businessId).maybeSingle();
  return data?.user_id ?? null;
}

// Той самий "delta від пам'яті останнього внеску" підхід, що і
// upsertPaypalRevenue у paypal-sync.mjs.
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

// Ідемпотентний запис комісії (delete+insert) — той самий принцип, що і
// upsertPaypalFeeExpense у paypal-sync.mjs. category: "other" — CHECK-
// констрейнт на public.expenses.category дозволяє лише
// 'advertising' | 'shipping' | 'cost_of_goods' | 'other'.
async function upsertMollieFeeExpense({ businessId, date, amount }) {
  await admin
    .from("expenses")
    .delete()
    .eq("business_id", businessId)
    .eq("date", date)
    .eq("source", "mollie")
    .eq("category", "other");

  if (amount > 0) {
    const { error } = await admin.from("expenses").insert({
      business_id: businessId,
      amount,
      category: "other",
      description: "Mollie processing fee (auto-synced)",
      date,
      source: "mollie",
    });
    if (error) {
      console.error(`Failed to insert Mollie fee expense for ${businessId} ${date}:`, error.message);
      await logError({ source: "mollie", message: "expenses insert failed (fee)", details: error.message, businessId });
    }
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
      const secrets = JSON.parse(decrypt(integ.api_key_encrypted));
      const apiKey = secrets.api_key;
      const advancedAccessToken = secrets.advanced_access_token;
      if (!apiKey) throw new Error("Missing Mollie API key");
      if (!advancedAccessToken) throw new Error("Missing Mollie Advanced access token — reconnect Mollie");

      const sinceUnix = sinceDaysOverride ? nowSec - sinceDaysOverride * 24 * 3600 : nowSec - 48 * 3600;

      const [payments, feesByPaymentId] = await Promise.all([
        fetchMolliePayments(apiKey, sinceUnix),
        fetchMollieFeesByPaymentId(advancedAccessToken, sinceUnix),
      ]);

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
      let paymentsWithoutFeeMatch = 0;

      const byDate = {};
      for (const p of payments) {
        // Тільки успішно оплачені платежі — той самий принцип, що і
        // transaction_status=S у PayPal.
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

        if (!byDate[date]) byDate[date] = { revenue: 0, orders: 0, fee: 0 };
        byDate[date].revenue += amount * rate;
        byDate[date].orders += 1;

        // Реальна комісія цього конкретного платежу з Balance Transactions
        // API (не оцінка). Якщо баланс ще не встиг зафіксувати рух (платіж
        // щойно пройшов, повільний метод типу картки — "може зайняти
        // кілька днів") — комісія цього разу просто відсутня в мапі, а не
        // помилково нульова: наступний прогін (вікно 48г перекривається)
        // підхопить її, коли вона з'явиться в balance transactions.
        const feeEntry = feesByPaymentId.get(p.id);
        if (feeEntry) {
          const feeCurrency = feeEntry.currency;
          let feeRate = 1;
          if (feeCurrency !== bizCurrency) {
            try {
              feeRate = await getExchangeRate(feeCurrency, bizCurrency, date);
            } catch {
              feeRate = rate; // fallback: курс самого платежу того ж дня, краще ніж нічого
            }
          }
          byDate[date].fee += feeEntry.value * feeRate;
        } else {
          paymentsWithoutFeeMatch += 1;
        }
      }

      if (skippedNoRate > 0) {
        console.warn(`Mollie business ${integ.business_id}: ${skippedNoRate} payment(s) skipped — no ECB exchange rate available.`);
      }
      if (skippedTestMode > 0) {
        console.log(`Mollie business ${integ.business_id}: ${skippedTestMode} test-mode payment(s) excluded from revenue.`);
      }
      if (paymentsWithoutFeeMatch > 0) {
        // Не помилка — очікувано для щойно оплачених повільних методів,
        // яким ще не встиг осісти рух у балансі. Видно в логах, щоб
        // відрізнити від справжнього збою balances.read доступу.
        console.log(`Mollie business ${integ.business_id}: ${paymentsWithoutFeeMatch} payment(s) without a matching balance transaction yet (fee will land on a later sync).`);
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
        await upsertMollieFeeExpense({
          businessId: integ.business_id,
          date,
          amount: Number(agg.fee.toFixed(2)),
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
