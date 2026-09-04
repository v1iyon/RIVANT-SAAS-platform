// scripts/paypal-sync.mjs
//
// Sync-модуль для PayPal. Паттерн 1:1 з shopify-sync.mjs (не sync-stripe-core.mjs):
// PayPal тут — ДОДАТКОВИЙ платіжний канал, а не єдине джерело правди про
// виручку бізнесу (revenue_mode завжди "add", без чекбокса вибору — на
// відміну від Shopify тут нема сценарію "PayPal замінює все", бо PayPal
// ніколи не є системою управління замовленнями/каталогом). Тому:
//   - revenue_drop / payment_silence лишаються виключно за sync-stripe-core.mjs
//     (той самий принцип, що вже діє для Shopify — див. коментар там).
//   - тут лише sync_failure_paypal (технічний збій синку) і сам факт
//     запису виручки/комісії, як і в shopify-sync.mjs.
//
// PayPal REST API (не OAuth-редирект користувача — client_credentials на
// ВЛАСНИЙ акаунт клієнта, той самий "серверний" патерн, що вже є в
// Google Ads: клієнт створює власний App у developer.paypal.com, отримує
// Client ID + Secret, вставляє їх сюди; жодного зовнішнього ревью не треба,
// бо це доступ до ВЛАСНОГО акаунту, не OAuth-згода стороннього юзера).
//
// ПЕРЕВІРЕНО ПРОТИ ОФІЦІЙНОЇ ДОКУМЕНТАЦІЇ PayPal (03.09.2026), бо перший
// драфт цього файлу спирався на пам'ять моделі без звірки:
//   - GET /v1/reporting/transactions — СИНХРОННИЙ ендпоінт (List Transactions),
//     а НЕ асинхронний Transaction Reports API (POST + polling за file_id).
//     Це різні API. Тож "запит може повернути порожньо, поки звіт
//     формується" — не про цей ендпоінт. Реальний нюанс інший: PayPal сам
//     пише в доках "may take up to 3 hours for a transaction to appear in
//     the list transactions call" — тобто свіжа транзакція може бути не
//     видна одразу. Наше вікно синку — ковзні 48г щогодини, тож будь-яка
//     транзакція з такою затримкою підхопиться на одному з наступних
//     прогонів, без спеціального ретраю.
//   - "To use this API on behalf of third parties, you must be a PayPal
//     partner" — це про сценарій, коли МИ (RIVANT) одним партнерським
//     токеном тягнули б чужі акаунти. У нас інша модель: КОЖЕН клієнт сам
//     створює свій REST-застосунок у своєму developer.paypal.com і дає нам
//     СВОЇ Client ID/Secret — це "your own account" використання, під яке
//     partner-обмеження не підпадає.
//   - "Дані лише за останні 12 місяців" (версія з рев'ю) не підтвердилась:
//     офіційна документація прямо каже "lists transactions for the
//     previous three years". Бекфіл нижче тому орієнтується на 3 роки,
//     не на 12 місяців.
//
// Reporting/Transactions API обмежує діапазон одного запиту 31 днем —
// звичайний погодинний синк (вікно 48г) в це вкладається завжди, тому
// чанкінг потрібен лише для бекфілу.
//
// МУЛЬТИВАЛЮТНІ АКАУНТИ (03.09.2026, друга ітерація фіксу): PayPal-акаунт
// клієнта може приймати оплати в кількох валютах одразу, тоді як
// businesses.currency в продукті одна. Перша версія цього файлу просто
// пропускала "чужу" валюту (безпечно, але губило реальний дохід). Тепер:
//   1. Кожна транзакція в чужій валюті конвертується в bizCurrency по
//      історичному курсу ЄЦБ на дату транзакції (lib/fx-rates.mjs,
//      Frankfurter API — безкоштовний, без ключа, без реєстрації).
//   2. Транзакції з transaction_event_code групи T02xx (General/User-
//      initiated Currency Conversion — внутрішнє переміщення грошей між
//      валютними балансами акаунту, НЕ новий продаж) виключаються
//      повністю. Без цього кроку конвертований платіж рахувався б
//      ДВІЧІ: раз як сам продаж (який ми тепер самі конвертуємо), і ще
//      раз як службовий T02xx-запис PayPal про той самий переказ.
//   3. Якщо курсу ЄЦБ для конкретної валюти/дати нема (валюта поза ~30
//      охопленими ЄЦБ, чи Frankfurter недоступний саме зараз) — та ОДНА
//      транзакція пропускається й лічиться окремо в логах, решта дня
//      рахується коректно; вся синхронізація через це не падає.
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../lib/crypto.js";
import { logError } from "../lib/log-error.js";
import { sendAlertToBusiness, getUserContact } from "../lib/alerts.mjs";
import { getExchangeRate } from "../lib/fx-rates.mjs";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function paypalApiBase(environment) {
  return environment === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
}

const SYNC_FAILURE_MESSAGE = {
  UA: () => `Не вдалося синхронізувати PayPal`,
  EN: () => `Failed to sync PayPal`,
  DE: () => `PayPal Synchronisierung fehlgeschlagen`,
};

function getSyncFailureReason(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("401") || message.includes("invalid_client") || message.includes("authentication")) return "access_denied";
  if (message.includes("403") || message.includes("permission") || message.includes("scope")) return "missing_scope";
  if (message.includes("429") || message.includes("rate limit")) return "rate_limited";
  return "connection_failed";
}

const SYNC_FAILURE_EXPLANATION = {
  UA: {
    access_denied: "Перевірте Client ID/Secret PayPal у налаштуваннях інтеграції — можливо, вони застарілі або неправильні.",
    missing_scope: "У PayPal-застосунку клієнта немає доступу до Transaction Search API — увімкніть цей продукт у налаштуваннях застосунку в developer.paypal.com.",
    rate_limited: "PayPal тимчасово обмежив кількість запитів — синхронізація відновиться на наступному прогоні.",
    connection_failed: "Тимчасова помилка з'єднання з PayPal — перевірте статус інтеграції.",
  },
  EN: {
    access_denied: "Check the PayPal Client ID/Secret in integration settings — they may be outdated or incorrect.",
    missing_scope: "The client's PayPal app doesn't have Transaction Search API access — enable that product in the app settings at developer.paypal.com.",
    rate_limited: "PayPal temporarily rate-limited requests — sync will resume on the next run.",
    connection_failed: "Temporary connection issue with PayPal — check the integration status.",
  },
  DE: {
    access_denied: "Prüfen Sie Client ID/Secret von PayPal in den Integrationseinstellungen — sie könnten veraltet oder falsch sein.",
    missing_scope: "Die PayPal-App des Kunden hat keinen Zugriff auf die Transaction Search API — aktivieren Sie dieses Produkt in den App-Einstellungen auf developer.paypal.com.",
    rate_limited: "PayPal hat Anfragen vorübergehend limitiert — die Synchronisierung wird beim nächsten Lauf fortgesetzt.",
    connection_failed: "Vorübergehendes Verbindungsproblem mit PayPal — prüfen Sie den Integrationsstatus.",
  },
};

// Той самий підхід, що і в sync-stripe-core.mjs/shopify-sync.mjs/bot.js —
// "якому календарному дню бізнесу належить ця мить" по ЛОКАЛЬНІЙ таймзоні
// бізнесу, а не UTC.
function localDateStr(tz, atSec) {
  const d = atSec != null ? new Date(atSec * 1000) : new Date();
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC" }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(d);
  }
}

async function getAccessToken(clientId, clientSecret, environment) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${paypalApiBase(environment)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PayPal auth error: ${res.status} ${body}`.slice(0, 300));
  }
  const data = await res.json();
  if (!data.access_token) throw new Error("PayPal auth error: no access_token in response");
  return data.access_token;
}

// Розбиває [sinceUnix, untilUnix] на діапазони по <=31 дню — саме такий
// ліміт у PayPal Transaction Search API на один запит.
function chunkRanges(sinceUnix, untilUnix, maxDays = 31) {
  const chunks = [];
  const maxSpan = maxDays * 24 * 3600;
  let from = sinceUnix;
  while (from < untilUnix) {
    const to = Math.min(from + maxSpan, untilUnix);
    chunks.push([from, to]);
    from = to;
  }
  return chunks;
}

// transaction_status=S — лише успішні (Success). Це відсікає Pending/Denied/
// Reversed на рівні самого запиту, менше зайвих даних і менше ризику
// врахувати скасовану/повернуту операцію як дохід.
async function fetchPaypalTransactions(accessToken, sinceUnix, untilUnix, environment) {
  const all = [];
  for (const [fromSec, toSec] of chunkRanges(sinceUnix, untilUnix)) {
    let page = 1;
    for (let guard = 0; guard < 50; guard++) {
      // максимум 50 сторінок на чанк (по 500 = 25 000 транзакцій) — захист
      // від нескінченного циклу, з великим запасом навіть для 31-денного вікна.
      const params = new URLSearchParams({
        start_date: new Date(fromSec * 1000).toISOString(),
        end_date: new Date(toSec * 1000).toISOString(),
        fields: "transaction_info",
        transaction_status: "S",
        page_size: "500",
        page: String(page),
      });
      const res = await fetch(`${paypalApiBase(environment)}/v1/reporting/transactions?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`PayPal reporting error: ${res.status} ${body}`.slice(0, 300));
      }
      const data = await res.json();
      const details = data.transaction_details || [];
      all.push(...details);
      const totalPages = data.total_pages || 1;
      if (page >= totalPages || details.length === 0) break;
      page += 1;
    }
  }
  return all;
}

async function getBusinessUserId(businessId) {
  const { data } = await admin.from("businesses").select("user_id").eq("id", businessId).maybeSingle();
  return data?.user_id ?? null;
}

// Пишемо в expenses ідемпотентно (delete+insert), той самий принцип, що і
// upsertExpense у shopify-sync.mjs. category: "other" — реальний CHECK-
// констрейнт на public.expenses.category дозволяє лише 'advertising' |
// 'shipping' | 'cost_of_goods' | 'other' (див. фікс від 03.09.2026 у
// shopify-sync.mjs), окремої категорії під комісію процесингу там нема.
async function upsertPaypalFeeExpense({ businessId, date, amount }) {
  await admin
    .from("expenses")
    .delete()
    .eq("business_id", businessId)
    .eq("date", date)
    .eq("source", "paypal")
    .eq("category", "other");

  if (amount > 0) {
    const { error } = await admin.from("expenses").insert({
      business_id: businessId,
      amount,
      category: "other",
      description: "PayPal processing fee (auto-synced)",
      date,
      source: "paypal",
    });
    if (error) {
      console.error(`Failed to insert PayPal fee expense for ${businessId} ${date}:`, error.message);
      await logError({ source: "paypal", message: "expenses insert failed (fee)", details: error.message, businessId });
    }
  }
}

// Той самий "delta від пам'яті останнього внеску" підхід, що і
// upsertShopifyRevenue у shopify-sync.mjs (add-режим) — інакше при
// погодинному синку з вікном, що перекривається (48г), той самий день
// додавався б знову і знову, роздуваючи виручку в рази. PayPal тут завжди
// "add" (без чекбокса вибору режиму — див. коментар на початку файлу),
// тому цей шлях єдиний, окремого "replace" немає.
async function upsertPaypalRevenue({ integrationId, integrationConfig, businessId, date, revenue, orders }) {
  const { data: existing } = await admin
    .from("metrics_computed")
    .select("revenue, cost, orders")
    .eq("business_id", businessId)
    .eq("date", date)
    .maybeSingle();

  const memo = { ...(integrationConfig?.paypal_revenue_memo || {}) };
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
    console.error(`Failed to write PayPal revenue for ${businessId} ${date}:`, error.message);
    return;
  }

  if (integrationId) {
    const nextConfig = { ...(integrationConfig || {}), paypal_revenue_memo: memo };
    const { error: memoErr } = await admin.from("integrations").update({ config: nextConfig }).eq("id", integrationId);
    if (memoErr) console.error(`Failed to persist paypal_revenue_memo for integration ${integrationId}:`, memoErr.message);
    else integrationConfig.paypal_revenue_memo = memo; // тримаємо in-memory об'єкт актуальним для решти цього прогону
  }
}

async function main(businessId, options = {}) {
  const sinceDaysOverride = options.sinceDays || null;

  // Той самий self-heal, що і в sync-stripe-core.mjs/shopify-sync.mjs —
  // підбираємо і "error", щоб один тимчасовий збій не зупиняв синк назавжди.
  let query = admin
    .from("integrations")
    .select("id, business_id, api_key_encrypted, config")
    .eq("provider", "paypal")
    .in("status", ["connected", "error"]);
  if (businessId) query = query.eq("business_id", businessId);
  const { data: integrations, error: fetchErr } = await query;

  if (fetchErr) {
    console.error("Failed to fetch paypal integrations:", fetchErr.message);
    await logError({ source: "paypal", message: "Failed to fetch paypal integrations list", details: fetchErr.message });
    return;
  }
  if (!integrations?.length) {
    console.log("No connected PayPal integrations, nothing to sync.");
    return;
  }

  const nowSec = Math.floor(Date.now() / 1000);

  for (const integ of integrations) {
    try {
      const clientId = integ.config?.client_id;
      if (!clientId) throw new Error("Missing client_id in integration config");
      const clientSecret = decrypt(integ.api_key_encrypted);
      const environment = integ.config?.environment === "sandbox" ? "sandbox" : "live";

      const sinceUnix = sinceDaysOverride ? nowSec - sinceDaysOverride * 24 * 3600 : nowSec - 48 * 3600;

      const accessToken = await getAccessToken(clientId, clientSecret, environment);
      const transactions = await fetchPaypalTransactions(accessToken, sinceUnix, nowSec, environment);

      const { data: business } = await admin
        .from("businesses")
        .select("id, timezone, currency")
        .eq("id", integ.business_id)
        .maybeSingle();
      if (!business) continue;
      const bizTimezone = business.timezone || "UTC";
      // Бізнес у цьому продукті вважається одновалютним для показу метрик
      // (businesses.currency), але PayPal-акаунт клієнта цілком може
      // приймати платежі в кількох валютах одразу. Раніше (перша версія
      // цього файлу) чужа валюта просто пропускалась — безпечно, але
      // губило реальний дохід для кожного, хто приймає більше однієї
      // валюти. Тепер конвертуємо по історичному курсу ЄЦБ на дату
      // транзакції (lib/fx-rates.mjs) і рахуємо в bizCurrency — так само,
      // як показує сам PayPal, коли конвертує чужу валюту в holding-валюту
      // акаунту. Якщо курсу немає (валюта поза довідником ЄЦБ, чи сам
      // Frankfurter недоступний у моменті) — конкретна транзакція
      // пропускається й рахується окремо, решта дня рахується коректно
      // (не валимо весь синк через один недоступний курс).
      const bizCurrency = (business.currency || "USD").toUpperCase();
      let skippedNoRate = 0;

      const byDate = {};
      for (const tx of transactions) {
        const info = tx.transaction_info;
        if (!info) continue;

        // ФІКС (аудит 03.09.2026, критично для мультивалютних акаунтів):
        // T02xx — окрема група T-кодів "General/User-initiated Currency
        // Conversion" (перевірено по офіційному довіднику
        // developer.paypal.com/reports/reference/t-codes) — це ВНУТРІШНЄ
        // переміщення грошей між валютними балансами всередині акаунту, а
        // НЕ новий продаж. Якщо клієнт приймає оплату в чужій валюті,
        // PayPal може створити ОКРЕМИЙ T02xx-запис на суму конвертації в
        // basе-валюту — той самий платіж, вдруге. Ми вже рахуємо реальний
        // продаж (T-код групи платежів, оригінальна валюта покупця) і самі
        // конвертуємо його по курсу ЄЦБ нижче — тож T02xx тут виключаємо
        // повністю, інакше та сама сума порахувалась би двічі.
        if (String(info.transaction_event_code || "").toUpperCase().startsWith("T02")) continue;

        const amount = Number(info.transaction_amount?.value);
        // Від'ємна сума (рефанд/чарджбек) чи 0 — не дохід, пропускаємо. Успішні
        // платежі (transaction_status=S у самому запиті) завжди мають
        // додатну суму — реальні повернення приходять окремими transaction-
        // записами з від'ємним значенням, а не статусом.
        if (!Number.isFinite(amount) || amount <= 0) continue;

        const createdSec = info.transaction_initiation_date
          ? Math.floor(new Date(info.transaction_initiation_date).getTime() / 1000)
          : null;
        if (!createdSec) continue;

        const date = localDateStr(bizTimezone, createdSec);
        const txCurrency = (info.transaction_amount?.currency_code || bizCurrency).toUpperCase();

        let rate = 1;
        if (txCurrency !== bizCurrency) {
          try {
            rate = await getExchangeRate(txCurrency, bizCurrency, date);
          } catch (fxErr) {
            skippedNoRate += 1;
            console.warn(`PayPal business ${integ.business_id}: no FX rate ${txCurrency}->${bizCurrency} for ${date}, skipping one transaction:`, fxErr.message);
            continue;
          }
        }

        if (!byDate[date]) byDate[date] = { revenue: 0, orders: 0, fee: 0 };
        byDate[date].revenue += amount * rate;
        byDate[date].orders += 1;
        // fee_amount у PayPal зазвичай від'ємний (це відрахування) —
        // беремо модуль, щоб отримати позитивну суму витрати. Комісія
        // завжди в тій самій валюті, що й сама транзакція, тому
        // конвертуємо тим самим курсом.
        const feeRaw = Number(info.fee_amount?.value);
        if (Number.isFinite(feeRaw)) byDate[date].fee += Math.abs(feeRaw) * rate;
      }

      if (skippedNoRate > 0) {
        // Не тихо — видно в логах крону, і причина зрозуміла (курсу не
        // знайшлось для конкретної валюти/дати, а не помилка синку).
        console.warn(`PayPal business ${integ.business_id}: ${skippedNoRate} transaction(s) skipped — no ECB exchange rate available.`);
      }

      for (const [date, agg] of Object.entries(byDate)) {
        await upsertPaypalRevenue({
          integrationId: integ.id,
          integrationConfig: integ.config || {},
          businessId: integ.business_id,
          date,
          revenue: Number(agg.revenue.toFixed(2)),
          orders: agg.orders,
        });
        await upsertPaypalFeeExpense({
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

      console.log(`PayPal synced business ${integ.business_id}: ${Object.keys(byDate).length} day(s)`);
    } catch (err) {
      console.error(`Failed to sync PayPal integration ${integ.id}:`, err.message);
      await logError({
        source: "paypal",
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
        type: "sync_failure_paypal",
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
