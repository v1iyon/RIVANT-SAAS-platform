// scripts/woocommerce-sync.mjs
//
// Sync-модуль для WooCommerce, той самий паттерн, що і в shopify-sync.mjs /
// meta-ads-sync.mjs: розшифрувати ключ -> запит до API провайдера -> запис
// виручки в metrics_computed і витрат у expenses -> алерти -> помилки в
// error_logs. Аддитивне джерело виручки (не заміна Stripe за замовчуванням,
// той самий revenue_mode "replace"/"add", що і в Shopify).
//
// ВІДМІННОСТІ ВІД SHOPIFY, важливі для розуміння коду нижче:
//
// 1. Автентифікація: WooCommerce REST API v3 не видає окремий access
//    token — тільки пару Consumer Key / Consumer Secret, згенеровану в
//    WP Admin -> WooCommerce -> Settings -> Advanced -> REST API. Ми
//    використовуємо їх як Basic Auth (Authorization: Basic base64(ck:cs))
//    over HTTPS, а не query-параметри (?consumer_key=...&consumer_secret=...) —
//    останні документовані самим WooCommerce як менш безпечні (осідають у
//    логах веб-сервера/проксі). Consumer Secret зберігається так само, як
//    Shopify Client Secret — у зашифрованому api_key_encrypted (apiKey поле
//    форми), Consumer Key — у config (не секрет для показу назад у UI,
//    той самий принцип, що й client_id у Shopify).
//
// 2. Домен магазину ДОВІЛЬНИЙ (self-hosted WordPress на домені клієнта),
//    на відміну від фіксованого *.myshopify.com у Shopify — тому SSRF-
//    перевірка тут не regex по суфіксу, а lib/woocommerce-url.js
//    (синтаксис + DNS-резолв і блокування приватних/reserved адрес,
//    включно з cloud-metadata 169.254.169.254). Перевіряється і при
//    підключенні (connect-integration/route.js), і повторно тут при
//    кожному синку — DNS міг змінитись після підключення (rebinding).
//
// 3. Пагінація: не cursor-based GraphQL, як у Shopify, а звичайний
//    page/per_page з заголовком X-WP-TotalPages у відповіді.
//
// 4. Собівартість товару (COGS): WooCommerce В ЯДРІ НЕ МАЄ поля
//    собівартості (на відміну від Shopify inventory_item.cost) — це
//    з'являється тільки через сторонні плагіни (Cost of Goods for
//    WooCommerce тощо), яких у клієнта може не бути. Свідомо НЕ пишемо
//    жодного значення cogs — вигадувати чи оцінювати собівартість
//    "приблизно" було б порушенням принципу "тільки факти, без
//    вигаданих цифр". Якщо клієнту знадобиться COGS з WooCommerce —
//    це окрема задача під конкретний плагін, яким він користується.
//
// 5. Знижка на повернення: total замовлення в WooCommerce НЕ
//    перераховується автоматично при частковому рефанді (на відміну від
//    Shopify current_total_price) — сума повернень лежить окремо в
//    order.refunds[].total (від'ємне число). Віднімаємо суму refunds від
//    total, щоб отримати фактичну виручку, так само як Shopify це робить
//    сам всередині свого API.
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../lib/crypto.js";
import { logError } from "../lib/log-error.js";
import { normalizeStoreUrl, assertPublicHostname } from "../lib/woocommerce-url.js";
import { sendAlertToBusiness, getUserContact, generateAlertExplanation, detectExpenseAnomaly, getAlertSensitivity } from "../lib/alerts.mjs";

const SYNC_FAILURE_MESSAGE = {
  UA: () => `Не вдалося синхронізувати WooCommerce`,
  EN: () => `Failed to sync WooCommerce`,
  DE: () => `WooCommerce Synchronisierung fehlgeschlagen`,
};

function getSyncFailureReason(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("private/internal") || message.includes("could not resolve")) return "store_not_found";
  if (message.includes("401") || message.includes("403") || message.includes("woocommerce_rest_authentication_error")) return "access_denied";
  if (message.includes("404") || message.includes("not found") || message.includes("rest_no_route")) return "store_not_found";
  return "connection_failed";
}

const SYNC_FAILURE_EXPLANATION = {
  UA: {
    access_denied: "Перевірте Consumer Key/Secret у WooCommerce -> Settings -> Advanced -> REST API.",
    store_not_found: "Перевірте адресу магазину WooCommerce — вона має бути доступна ззовні.",
    connection_failed: "Перевірте доступ REST API WooCommerce.",
  },
  EN: {
    access_denied: "Check the Consumer Key/Secret in WooCommerce -> Settings -> Advanced -> REST API.",
    store_not_found: "Check the WooCommerce store address — it must be reachable from outside.",
    connection_failed: "Check the WooCommerce REST API access.",
  },
  DE: {
    access_denied: "Prüfen Sie Consumer Key/Secret in WooCommerce -> Settings -> Advanced -> REST API.",
    store_not_found: "Prüfen Sie die WooCommerce-Shop-Adresse — sie muss von außen erreichbar sein.",
    connection_failed: "Prüfen Sie den Zugriff der WooCommerce REST API.",
  },
};

const SHIPPING_SPIKE_MESSAGE = {
  UA: (pct, avg, today, date) => `Витрати на доставку (WooCommerce) зросли на ${pct}% (з $${Math.round(avg)} до $${Math.round(today)}) ${date}`,
  EN: (pct, avg, today, date) => `WooCommerce shipping costs jumped ${pct}% (from $${Math.round(avg)} to $${Math.round(today)}) on ${date}`,
  DE: (pct, avg, today, date) => `WooCommerce-Versandkosten sind am ${date} um ${pct}% gestiegen (von $${Math.round(avg)} auf $${Math.round(today)})`,
};

const LOW_STOCK_MESSAGE = {
  UA: (name, quantity) => `Низький залишок (WooCommerce): «${name}» — ${quantity} шт.`,
  EN: (name, quantity) => `Low stock (WooCommerce): “${name}” — ${quantity} units.`,
  DE: (name, quantity) => `Niedriger Bestand (WooCommerce): „${name}“ — ${quantity} Stück.`,
};

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const WC_API_PATH = "/wp-json/wc/v3";
const LOW_STOCK_THRESHOLD = 20;
// Статуси, які вважаємо реалізованою виручкою. "pending"/"on-hold" — оплата
// ще не підтверджена, "cancelled"/"failed"/"trash" — це не гроші взагалі.
const REVENUE_ORDER_STATUSES = ["processing", "completed", "refunded"];

function localDateStr(tz, dateInput) {
  const d = typeof dateInput === "string" || typeof dateInput === "number" ? new Date(dateInput) : dateInput;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC" }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(d);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function authHeader(consumerKey, consumerSecret) {
  const token = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  return `Basic ${token}`;
}

// date_created_gmt приходить від WooCommerce без "Z" на кінці (напр.
// "2026-08-30T12:00:00"), хоча це вже UTC — додаємо суфікс явно, інакше
// Date() трактує рядок без офсету як локальний час машини, на якій
// виконується скрипт (GitHub Actions runner — UTC, але покладатись на
// збіг випадково не варто).
function parseGmtDate(raw) {
  if (!raw) return null;
  return new Date(raw.endsWith("Z") ? raw : `${raw}Z`);
}

async function fetchWooOrders(storeUrl, consumerKey, consumerSecret, sinceIso) {
  const allOrders = [];
  let page = 1;
  let totalPages = 1;
  const pageGuard = 200; // 200 * 100 = до 20 000 замовлень за прогін, з запасом

  do {
    const url = new URL(`${storeUrl}${WC_API_PATH}/orders`);
    url.searchParams.set("after", sinceIso);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    url.searchParams.set("status", REVENUE_ORDER_STATUSES.join(","));
    url.searchParams.set("orderby", "date");
    url.searchParams.set("order", "asc");

    const res = await fetch(url.toString(), {
      headers: { Authorization: authHeader(consumerKey, consumerSecret) },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`WooCommerce API error: ${res.status} — ${body.slice(0, 300)}`);
    }

    const orders = await res.json();
    for (const order of orders) {
      const refundsTotal = (order.refunds || []).reduce((sum, r) => sum + Math.abs(Number(r.total) || 0), 0);
      allOrders.push({
        id: order.id,
        status: order.status,
        date_created_gmt: order.date_created_gmt,
        total: Number(order.total) || 0,
        shipping_total: Number(order.shipping_total) || 0,
        refunds_total: refundsTotal,
      });
    }

    totalPages = Number(res.headers.get("x-wp-totalpages")) || 1;
    page += 1;
    if (page <= totalPages) await sleep(200); // не молотимо API спільного хостингу без потреби
  } while (page <= totalPages && page <= pageGuard);

  return allOrders;
}

// Просте (не varitation-aware) читання залишків: перевіряємо тільки прості
// товари з увімкненим manage_stock. Варіативні товари (variable products)
// зберігають кількість на рівні кожної variation окремим API-запитом (та
// сама "N+1" проблема, що й Shopify variant cost) — свідомо не тягнемо їх
// тут, щоб не перетворювати рутинний погодинний синк на сотні запитів на
// кожен прогін; це врівноважений компроміс, а не забута фіча.
async function fetchLowStockProducts(storeUrl, consumerKey, consumerSecret) {
  const lowStock = [];
  let page = 1;
  let totalPages = 1;

  do {
    const url = new URL(`${storeUrl}${WC_API_PATH}/products`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    url.searchParams.set("status", "publish");
    url.searchParams.set("type", "simple");

    const res = await fetch(url.toString(), {
      headers: { Authorization: authHeader(consumerKey, consumerSecret) },
    });
    if (!res.ok) throw new Error(`WooCommerce inventory request failed: ${res.status}`);

    const products = await res.json();
    for (const product of products) {
      if (!product.manage_stock) continue;
      const quantity = Number(product.stock_quantity);
      if (Number.isFinite(quantity) && quantity < LOW_STOCK_THRESHOLD) {
        lowStock.push({ id: product.id, name: product.name, quantity });
      }
    }

    totalPages = Number(res.headers.get("x-wp-totalpages")) || 1;
    page += 1;
    if (page <= totalPages) await sleep(200);
  } while (page <= totalPages && page <= 50);

  return lowStock;
}

function computeRevenueByDate(orders, tz) {
  const byDate = {};
  for (const order of orders) {
    const date = localDateStr(tz, parseGmtDate(order.date_created_gmt));
    const amount = order.total - order.refunds_total;
    byDate[date] = (byDate[date] || 0) + amount;
  }
  return byDate;
}

function computeShippingByDate(orders, tz) {
  const byDate = {};
  for (const order of orders) {
    const date = localDateStr(tz, parseGmtDate(order.date_created_gmt));
    byDate[date] = (byDate[date] || 0) + (order.shipping_total || 0);
  }
  return byDate;
}

async function getBusinessUserId(businessId) {
  const { data } = await admin.from("businesses").select("user_id").eq("id", businessId).maybeSingle();
  return data?.user_id ?? null;
}

// Той самий read-modify-write + delta-мемо підхід, що й upsertShopifyRevenue
// у scripts/shopify-sync.mjs (див. довгий коментар там) — щоб при погодинних
// перепрогонах вікна синку "add"-режим не роздував дохід за день на кожному
// прогоні, а "replace" залишався єдиним джерелом виручки за цю дату.
async function upsertWooRevenue({ integrationId, integrationConfig, businessId, date, revenue, orders, revenueMode }) {
  const { data: existing } = await admin
    .from("metrics_computed")
    .select("revenue, cost, orders")
    .eq("business_id", businessId)
    .eq("date", date)
    .maybeSingle();

  let finalRevenue;
  let finalOrders;
  let updatedMemo = null;

  if (revenueMode === "add") {
    const memo = { ...(integrationConfig?.woocommerce_revenue_memo || {}) };
    const prevContribution = Number(memo[date] || 0);
    const delta = Number((revenue - prevContribution).toFixed(2));
    finalRevenue = Number(((existing?.revenue || 0) + delta).toFixed(2));
    finalOrders = Math.max(0, (existing?.orders || 0) + orders - Number(memo[`${date}_orders`] || 0));
    memo[date] = revenue;
    memo[`${date}_orders`] = orders;
    const cutoff = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    for (const key of Object.keys(memo)) {
      const keyDate = key.replace(/_orders$/, "");
      if (keyDate < cutoff) delete memo[key];
    }
    updatedMemo = memo;
  } else {
    finalRevenue = Number(revenue.toFixed(2));
    finalOrders = orders;
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
  if (error) console.error(`Failed to write WooCommerce revenue for ${businessId} ${date}:`, error.message);

  if (updatedMemo && integrationId) {
    const { error: memoErr } = await admin
      .from("integrations")
      .update({ config: { ...(integrationConfig || {}), woocommerce_revenue_memo: updatedMemo } })
      .eq("id", integrationId);
    if (memoErr) console.error(`Failed to persist woocommerce_revenue_memo for integration ${integrationId}:`, memoErr.message);
    else integrationConfig.woocommerce_revenue_memo = updatedMemo;
  }
}

async function upsertExpense({ businessId, date, amount, category, source, description }) {
  await admin
    .from("expenses")
    .delete()
    .eq("business_id", businessId)
    .eq("date", date)
    .eq("source", source)
    .eq("category", category);

  if (amount > 0) {
    // ФІКС (той самий, що застосований у scripts/shopify-sync.mjs, аудит
    // 03.09.2026): .insert() тут раніше не перевірявся — будь-яка помилка
    // (напр. значення category поза CHECK-констрейнтом public.expenses —
    // дозволені лише 'advertising'|'shipping'|'cost_of_goods'|'other', див.
    // supabase/migrations/20260828000000_baseline_catchup.sql) мовчки
    // губила запис без жодного сліду в логах. category тут завжди
    // "shipping" (дозволене значення), тому цей код не мав тієї самої
    // конкретної проблеми, що Shopify COGS — але сам патерн "не перевіряти
    // insert" небезпечний для будь-якої майбутньої зміни тут, тому фіксимо
    // так само проактивно.
    const { error } = await admin.from("expenses").insert({
      business_id: businessId,
      amount,
      category,
      description,
      date,
      source,
    });
    if (error) {
      console.error(`Failed to insert expense (${category}/${source}) for ${businessId} ${date}:`, error.message);
      await logError({
        source: "woocommerce",
        message: `expenses insert failed: ${category}/${source}`,
        details: error.message,
        businessId,
      });
    }
  }
}

async function main(businessId, options = {}) {
  // Той самий self-lockout fix, що й у shopify-sync.mjs / meta-ads-sync.mjs —
  // підбираємо і "error", щоб синк міг сам відновитись після тимчасового збою.
  let query = admin
    .from("integrations")
    .select("id, business_id, api_key_encrypted, config")
    .eq("provider", "woocommerce")
    .in("status", ["connected", "error"]);
  if (businessId) query = query.eq("business_id", businessId);
  const { data: integrations, error: fetchErr } = await query;

  if (fetchErr) {
    console.error("Failed to fetch woocommerce integrations:", fetchErr.message);
    return;
  }
  if (!integrations?.length) {
    console.log("No connected WooCommerce integrations, nothing to sync.");
    return;
  }

  // sinceDays — лише для одноразового бекфілу (app/api/cron/backfill-historical),
  // той самий принцип, що й у meta-ads-sync.mjs/google-ads-sync.mjs. Дефолт
  // 48г — те саме вікно, що й у Shopify/Stripe для звичайних погодинних прогонів.
  const sinceDays = options.sinceDays || 2;
  const sinceIso = new Date(Date.now() - sinceDays * 24 * 3600 * 1000).toISOString();

  for (const integ of integrations) {
    try {
      const storeUrl = normalizeStoreUrl(integ.config?.store_url);
      if (!storeUrl) {
        throw new Error("Missing or invalid store_url in integration config");
      }
      await assertPublicHostname(new URL(storeUrl).hostname);

      const consumerKey = integ.config?.consumer_key;
      if (!consumerKey) {
        throw new Error("Missing consumer_key in integration config");
      }
      const consumerSecret = decrypt(integ.api_key_encrypted);

      const orders = await fetchWooOrders(storeUrl, consumerKey, consumerSecret, sinceIso);

      const { data: bizRow } = await admin
        .from("businesses")
        .select("timezone")
        .eq("id", integ.business_id)
        .maybeSingle();
      const bizTimezone = bizRow?.timezone || "UTC";

      const shippingByDate = computeShippingByDate(orders, bizTimezone);
      for (const [date, amount] of Object.entries(shippingByDate)) {
        await upsertExpense({
          businessId: integ.business_id,
          date,
          amount: Number(amount.toFixed(2)),
          category: "shipping",
          source: "woocommerce",
          description: "WooCommerce shipping cost (auto-synced)",
        });
      }

      const revenueMode = integ.config?.revenue_mode === "add" ? "add" : "replace";
      const revenueByDate = computeRevenueByDate(orders, bizTimezone);
      const ordersCountByDate = {};
      for (const order of orders) {
        const date = localDateStr(bizTimezone, parseGmtDate(order.date_created_gmt));
        ordersCountByDate[date] = (ordersCountByDate[date] || 0) + 1;
      }
      for (const [date, revenue] of Object.entries(revenueByDate)) {
        await upsertWooRevenue({
          integrationId: integ.id,
          integrationConfig: integ.config || {},
          businessId: integ.business_id,
          date,
          revenue,
          orders: ordersCountByDate[date] || 0,
          revenueMode,
        });
      }

      // Товарні залишки — окрема, не критична для фінансів перевірка (див.
      // коментар у fetchLowStockProducts): збій тут не повинен ламати сам
      // факт успішного синку виручки/доставки.
      try {
        const lowStockProducts = await fetchLowStockProducts(storeUrl, consumerKey, consumerSecret);
        if (lowStockProducts.length) {
          const contact = await getUserContact(await getBusinessUserId(integ.business_id));
          for (const item of lowStockProducts) {
            const message = (LOW_STOCK_MESSAGE[contact.userLang] || LOW_STOCK_MESSAGE.EN)(item.name, item.quantity);
            await sendAlertToBusiness(integ.business_id, contact, {
              type: `low_stock_woocommerce_${item.id}`,
              severity: item.quantity === 0 ? "critical" : item.quantity <= 5 ? "medium" : "low",
              message,
              cooldownHours: 24 * 7, // той самий тижневий cooldown, що і в Shopify
            });
          }
        }
      } catch (inventoryError) {
        console.warn(`WooCommerce inventory check skipped for ${integ.id}:`, inventoryError.message);
      }

      const latestDate = Object.keys(shippingByDate).sort().pop();
      if (latestDate && shippingByDate[latestDate] != null) {
        const contact = await getUserContact(await getBusinessUserId(integ.business_id));
        const sensitivityMultiplier = await getAlertSensitivity(integ.business_id);
        const anomaly = await detectExpenseAnomaly({
          businessId: integ.business_id,
          source: "woocommerce",
          category: "shipping",
          date: latestDate,
          todayAmount: shippingByDate[latestDate],
          sensitivityMultiplier,
        });
        if (anomaly?.kind === "spike") {
          const msg = (SHIPPING_SPIKE_MESSAGE[contact.userLang] || SHIPPING_SPIKE_MESSAGE.EN)(anomaly.pct, anomaly.avg, anomaly.today, latestDate);
          const explanation = await generateAlertExplanation(
            contact.userLang,
            `WooCommerce shipping costs jumped ${anomaly.pct}% versus the 7-day average (from $${Math.round(anomaly.avg)} to $${Math.round(anomaly.today)}) on ${latestDate}.`
          );
          await sendAlertToBusiness(integ.business_id, contact, {
            type: "shipping_spike_woocommerce",
            severity: anomaly.pct >= 100 ? "high" : "medium",
            message: msg,
            aiExplanation: explanation,
          });
        }
      }

      const { sync_error_reason: _previousError, ...cleanConfig } = integ.config || {};
      await admin
        .from("integrations")
        .update({ last_synced_at: new Date().toISOString(), status: "connected", config: cleanConfig })
        .eq("id", integ.id);

      console.log(`WooCommerce synced business ${integ.business_id}: ${Object.keys(revenueByDate).length} day(s) revenue`);
    } catch (err) {
      console.error(`Failed to sync WooCommerce integration ${integ.id}:`, err.message);
      await logError({
        source: "woocommerce",
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
        type: "sync_failure_woocommerce",
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
