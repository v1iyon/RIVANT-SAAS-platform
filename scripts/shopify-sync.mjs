// scripts/shopify-sync.mjs
//
// Этап 3 плана — sync-модуль для Shopify. Паттерн 1:1 с sync-stripe-core.mjs:
// расшифровать ключ -> запрос к API провайдера -> запись в expenses -> логирование ошибок.
//
// Пишем в expenses и СТОИМОСТЬ ДОСТАВКИ (shipping, есть прямо в заказе), и
// СЕБЕСТОИМОСТЬ ТОВАРА (cost of goods). Себестоимость лежит на уровне
// inventory_item.cost, а не в заказе — поэтому на каждый УНИКАЛЬНЫЙ variant
// в окне синка уходит 2 доп. запроса к Shopify (variant → inventory_item_id,
// потом inventory_item → cost). Кэшируем в рамках одного прогона, чтобы один
// и тот же товар не запрашивался повторно, если его купили несколько раз.
// Важно: Shopify REST ограничивает ~2 запроса/сек (leaky bucket), поэтому
// запросы идут последовательно с небольшой паузой — при большом ассортименте
// синк может занять заметное время (сотни SKU = пара минут). Если вариант
// не имеет cost, выставленного в Shopify (поле пустое), он просто
// пропускается — его нельзя посчитать, это не баг.
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../lib/crypto.js";
import { logError } from "../lib/log-error.js";
import { resolveShopifyToken } from "../lib/shopify-token.mjs";
import { sendAlertToBusiness, getUserContact, generateAlertExplanation, detectExpenseAnomaly, getAlertSensitivity } from "../lib/alerts.mjs";

const SYNC_FAILURE_MESSAGE = {
  UA: () => `Не вдалося синхронізувати Shopify`,
  EN: () => `Failed to sync Shopify`,
  DE: () => `Shopify Synchronisierung fehlgeschlagen`,
};

function getSyncFailureReason(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("app_not_installed")) return "app_not_installed";
  if (message.includes("401") || message.includes("403") || message.includes("token")) return "access_denied";
  if (message.includes("404") || message.includes("not found")) return "store_not_found";
  return "connection_failed";
}

const SYNC_FAILURE_EXPLANATION = {
  UA: {
    app_not_installed: "Застосунок RIVANT не встановлено в Shopify.",
    access_denied: "Перевірте доступ застосунку та токен Shopify.",
    store_not_found: "Перевірте адресу магазину Shopify.",
    connection_failed: "Перевірте доступ застосунку Shopify.",
  },
  EN: {
    app_not_installed: "The RIVANT app is not installed in Shopify.",
    access_denied: "Check the Shopify app access and token.",
    store_not_found: "Check the Shopify store address.",
    connection_failed: "Check the Shopify app access.",
  },
  DE: {
    app_not_installed: "Die RIVANT-App ist nicht in Shopify installiert.",
    access_denied: "Prüfen Sie App-Zugriff und Shopify-Token.",
    store_not_found: "Prüfen Sie die Shopify-Shop-Adresse.",
    connection_failed: "Prüfen Sie den Zugriff der Shopify-App.",
  },
};

const COGS_SPIKE_MESSAGE = {
  UA: (pct, avg, today, date) => `Собівартість товарів зросла на ${pct}% (з $${Math.round(avg)} до $${Math.round(today)}) ${date}`,
  EN: (pct, avg, today, date) => `Cost of goods jumped ${pct}% (from $${Math.round(avg)} to $${Math.round(today)}) on ${date}`,
  DE: (pct, avg, today, date) => `Wareneinsatz ist am ${date} um ${pct}% gestiegen (von $${Math.round(avg)} auf $${Math.round(today)})`,
};

const SHIPPING_SPIKE_MESSAGE = {
  UA: (pct, avg, today, date) => `Витрати на доставку зросли на ${pct}% (з $${Math.round(avg)} до $${Math.round(today)}) ${date}`,
  EN: (pct, avg, today, date) => `Shipping costs jumped ${pct}% (from $${Math.round(avg)} to $${Math.round(today)}) on ${date}`,
  DE: (pct, avg, today, date) => `Versandkosten sind am ${date} um ${pct}% gestiegen (von $${Math.round(avg)} auf $${Math.round(today)})`,
};

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const SHOPIFY_API_VERSION = "2024-01";
const LOW_STOCK_THRESHOLD = 20;

// ФІКС: раніше всі дати тут рахувались по UTC (new Date(...).toISOString().
// slice(0,10)), тоді як sync-stripe-core.mjs уже давно перейшов на локальну
// дату бізнеса (див. коментар на початку того файлу — саме ця розбіжність
// колись ламала дайджест/бота). Для shopify-authoritative бізнесів (дефолтний
// revenue_mode: "replace") це та сама проблема: замовлення під кінець/початок
// локального дня потрапляли не в той стовпчик графіка. Тепер Shopify рахує
// дати так само, як Stripe — по timezone бізнесу.
function localDateStr(tz, dateInput) {
  const d = typeof dateInput === "string" || typeof dateInput === "number" ? new Date(dateInput) : dateInput;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC" }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(d);
  }
}

function normalizeShopDomain(raw) {
  let domain = (raw || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!domain) return null;
  if (!domain.endsWith(".myshopify.com") && !domain.includes(".")) {
    domain = `${domain}.myshopify.com`;
  }
  return domain;
}

// Извлекает числовой ID из Shopify GraphQL GID вида "gid://shopify/Order/123456".
// Нужен, чтобы line_items[].variant_id остался числом — на него завязан REST-запрос
// в fetchVariantCost() ниже, который мы намеренно не трогаем.
function extractNumericId(gid) {
  if (!gid) return null;
  const match = String(gid).match(/(\d+)$/);
  return match ? Number(match[1]) : null;
}

const ORDERS_GRAPHQL_QUERY = `
  query GetOrders($cursor: String, $searchQuery: String!) {
    orders(first: 100, after: $cursor, query: $searchQuery, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          createdAt
          cancelledAt
          currentTotalPriceSet { shopMoney { amount } }
          totalShippingPriceSet { shopMoney { amount } }
          shippingLines(first: 10) { edges { node { originalPriceSet { shopMoney { amount } } } } }
          lineItems(first: 100) {
            edges { node { quantity variant { id } } }
          }
        }
      }
    }
  }
`;

// ВАЖНО: этот запрос намеренно не трогает customer, email, shippingAddress,
// billingAddress и другие protected-поля. Shopify гейтит Protected Customer
// Data на уровне ПОЛЕЙ в GraphQL (в отличие от REST /orders.json, который
// блокирует весь endpoint целиком, даже если фильтровать fields= в запросе —
// см. https://shopify.dev/docs/apps/launch/protected-customer-data). Поэтому
// этот запрос работает без всякого approval — ни для нас, ни для клиентов,
// и так будет для любого нового клиента, которого подключат в будущем.
// Если когда-нибудь понадобится email/адрес клиента — тогда и только тогда
// нужен будет Protected Customer Data approval, и только на эти поля.
async function fetchShopifyOrders(shopDomain, token, sinceIso) {
  const searchQuery = `created_at:>='${sinceIso}'`;
  const endpoint = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  const allOrders = [];
  let cursor = null;
  let hasNextPage = true;
  let pageGuard = 0; // защита от бесконечного цикла, если Shopify начнёт врать про hasNextPage

  while (hasNextPage && pageGuard < 50) {
    pageGuard += 1;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: ORDERS_GRAPHQL_QUERY,
        variables: { cursor, searchQuery },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Shopify API error: ${res.status} — ${body.slice(0, 300)}`);
    }

    const data = await res.json();

    if (data.errors) {
      // THROTTLED — GraphQL cost-based rate limit, не то же самое что REST leaky
      // bucket. Ждём и повторяем один раз ту же страницу вместо падения синка.
      const throttled = data.errors.some((e) => e.extensions?.code === "THROTTLED");
      if (throttled) {
        await sleep(2000);
        continue;
      }
      throw new Error(`Shopify GraphQL error: ${JSON.stringify(data.errors).slice(0, 300)}`);
    }

    const ordersPage = data.data?.orders;
    if (!ordersPage) break;

    for (const edge of ordersPage.edges) {
      const node = edge.node;
      // Реshape под REST-совместимую форму, которую уже ожидает остальной файл
      // (computeRevenueByDate, computeCogsByDate, main) — так их не пришлось
      // переписывать вообще.
      allOrders.push({
        id: extractNumericId(node.id),
        created_at: node.createdAt,
        cancelled_at: node.cancelledAt,
        current_total_price: node.currentTotalPriceSet?.shopMoney?.amount ?? "0",
        total_shipping_price_set: {
          shop_money: { amount: node.totalShippingPriceSet?.shopMoney?.amount ?? "0" },
        },
        shipping_lines: (node.shippingLines?.edges || []).map((e) => ({
          price: e.node.originalPriceSet?.shopMoney?.amount ?? "0",
        })),
        line_items: (node.lineItems?.edges || []).map((e) => ({
          quantity: e.node.quantity,
          variant_id: extractNumericId(e.node.variant?.id),
        })),
      });
    }

    hasNextPage = ordersPage.pageInfo?.hasNextPage ?? false;
    cursor = ordersPage.pageInfo?.endCursor ?? null;
  }

  return allOrders;
}

async function fetchLowStockVariants(shopDomain, token) {
  const lowStock = [];
  let url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/products.json?status=active&limit=250&fields=id,title,variants`;

  while (url) {
    const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    if (!res.ok) throw new Error(`Shopify inventory request failed: ${res.status}`);
    const data = await res.json();
    for (const product of data.products || []) {
      for (const variant of product.variants || []) {
        const quantity = Number(variant.inventory_quantity);
        if (variant.inventory_management === "shopify" && Number.isFinite(quantity) && quantity < LOW_STOCK_THRESHOLD) {
          lowStock.push({ id: variant.id, productTitle: product.title, variantTitle: variant.title, quantity });
        }
      }
    }
    const links = res.headers.get("link") || "";
    const next = links.match(/<([^>]+)>;\s*rel="next"/);
    url = next?.[1] || null;
  }
  return lowStock;
}

const LOW_STOCK_MESSAGE = {
  UA: (name, quantity) => `Низький залишок: «${name}» — ${quantity} шт.`,
  EN: (name, quantity) => `Low stock: “${name}” — ${quantity} units.`,
  DE: (name, quantity) => `Niedriger Bestand: „${name}“ — ${quantity} Stück.`,
};

// current_total_price — це вже фактична сума ПІСЛЯ повернень/часткових
// рефандів (на відміну від total_price, який лишається "як було виставлено
// на момент замовлення"). Скасовані замовлення (cancelled_at заповнений)
// прибираємо повністю — це не дохід.
function computeRevenueByDate(orders, tz) {
  const byDate = {};
  for (const order of orders) {
    if (order.cancelled_at) continue;
    const date = localDateStr(tz, order.created_at);
    const amount = Number(order.current_total_price) || 0;
    byDate[date] = (byDate[date] || 0) + amount;
  }
  return byDate;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getBusinessUserId(businessId) {
  const { data } = await admin.from("businesses").select("user_id").eq("id", businessId).maybeSingle();
  return data?.user_id ?? null;
}

// Записує дохід із Shopify-замовлень у metrics_computed — ту саму таблицю,
// яку sync-stripe-core.mjs заповнює зі Stripe. Один рядок на business+date,
// тому робимо read-modify-write, а не сліпий upsert: інакше перезаписали б
// cost/margin_pct/orders, які вже там могли лежати. revenue_mode:
//   "replace" (дефолт) — Shopify стає єдиним джерелом revenue за цю дату,
//     бо в переважній більшості випадків це ті самі гроші, що вже пройшли
//     через Stripe як платіжний процесор всередині Shopify Checkout —
//     складання дало б задвоєний дохід.
//   "add" — користувач явно позначив магазин як окремий, незалежний потік
//     грошей (чекбокс при підключенні) — тоді додаємо суму до того, що вже
//     є в рядку, а не заміщуємо.
//
// ФІКС (задвоєння доходу в режимі "add"): `revenue`, який приходить сюди —
// це ЗАВЖДИ повна сума Shopify-замовлень за ЦЮ ДАТУ, порахована наново з
// нуля (вікно синку sinceIso = now-48h перечитує Shopify щогодини заново,
// той самий підхід, що і в sync-stripe-core.mjs). Раніше в режимі "add" код
// робив `revenue + existing.revenue` — тобто щогодини ПОВНА денна сума
// Shopify додавалась ЗНОВУ поверх того, що вже лежало в рядку (а там уже
// могла бути ця ж сума з попереднього прогону). За добу, поки дата
// залишається в 48-годинному вікні синку (тобто ~48 годинних прогонів),
// дохід за день роздувався в десятки разів. Особливо критично саме для
// "add" — це режим для магазину БЕЗ Stripe, тобто нема іншого синку, який
// би перезаписав/скинув це значення між прогонами Shopify.
//
// Тепер пам'ятаємо в integrations.config.shopify_revenue_memo (мапа
// date -> сума, яку МИ САМІ востаннє туди додали) і на кожному прогоні
// додаємо лише РІЗНИЦЮ між новою порахованою сумою і тим, що вже додавали
// раніше за цю дату — так дохід за день завжди дорівнює РЕАЛЬНІЙ денній
// сумі Shopify (+ те, що додав іще хтось інший, напр. Stripe), а не сумі
// по кількості прогонів синку. Мапа обрізається до останніх 3 днів, щоб
// integrations.config не росло безмежно.
async function upsertShopifyRevenue({ integrationId, integrationConfig, businessId, date, revenue, orders, revenueMode }) {
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
    const memo = { ...(integrationConfig?.shopify_revenue_memo || {}) };
    const prevContribution = Number(memo[date] || 0);
    const delta = Number((revenue - prevContribution).toFixed(2));
    finalRevenue = Number(((existing?.revenue || 0) + delta).toFixed(2));
    finalOrders = Math.max(0, (existing?.orders || 0) + orders - Number(memo[`${date}_orders`] || 0));
    memo[date] = revenue;
    memo[`${date}_orders`] = orders;
    // Тримаємо мемо лише за останні 3 дні (той самий порядок величини, що
    // й вікно синку) — старі дати більше не оновлюються, зберігати їх сенсу
    // немає.
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
  if (error) console.error(`Failed to write Shopify revenue for ${businessId} ${date}:`, error.message);

  if (updatedMemo && integrationId) {
    const { error: memoErr } = await admin
      .from("integrations")
      .update({ config: { ...(integrationConfig || {}), shopify_revenue_memo: updatedMemo } })
      .eq("id", integrationId);
    if (memoErr) console.error(`Failed to persist shopify_revenue_memo for integration ${integrationId}:`, memoErr.message);
    else integrationConfig.shopify_revenue_memo = updatedMemo; // тримаємо in-memory config актуальним для наступних дат у цьому ж прогоні
  }
}

// cost of goods для одного variant_id: variant → inventory_item_id → inventory_item.cost.
// Возвращает число (юнит-себестоимость в валюте магазина) или null, если Shopify
// не отдал cost (поле не заполнено продавцом) либо variant/inventory_item недоступны.
async function fetchVariantCost(shopDomain, token, variantId) {
  try {
    const variantRes = await fetch(
      `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/variants/${variantId}.json?fields=id,inventory_item_id`,
      { headers: { "X-Shopify-Access-Token": token } }
    );
    if (!variantRes.ok) return null;
    const variantData = await variantRes.json();
    const inventoryItemId = variantData?.variant?.inventory_item_id;
    if (!inventoryItemId) return null;

    await sleep(550); // грубый троттлинг под лимит Shopify REST (~2 req/sec)

    const itemRes = await fetch(
      `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/inventory_items/${inventoryItemId}.json?fields=id,cost`,
      { headers: { "X-Shopify-Access-Token": token } }
    );
    if (!itemRes.ok) return null;
    const itemData = await itemRes.json();
    const cost = Number(itemData?.inventory_item?.cost);
    return Number.isFinite(cost) ? cost : null;
  } catch {
    return null;
  }
}

// Себестоимость по всем заказам окна синка. Каждый уникальный variant_id
// запрашивается у Shopify максимум один раз за прогон (кэш в variantCostCache),
// даже если товар встречается в нескольких заказах.
async function computeCogsByDate(shopDomain, token, orders, tz) {
  const uniqueVariantIds = [
    ...new Set(
      orders.flatMap((o) => (o.line_items || []).map((li) => li.variant_id).filter(Boolean))
    ),
  ];

  const variantCostCache = new Map();
  for (const variantId of uniqueVariantIds) {
    const cost = await fetchVariantCost(shopDomain, token, variantId);
    variantCostCache.set(variantId, cost);
    await sleep(550);
  }

  const byDate = {};
  for (const order of orders) {
    const date = localDateStr(tz, order.created_at);
    let orderCogs = 0;
    for (const li of order.line_items || []) {
      const unitCost = li.variant_id ? variantCostCache.get(li.variant_id) : null;
      if (unitCost == null) continue; // нет данных о себестоимости — пропускаем, не выдумываем
      orderCogs += unitCost * (Number(li.quantity) || 0);
    }
    if (orderCogs > 0) byDate[date] = (byDate[date] || 0) + orderCogs;
  }
  return byDate;
}

// Пишем в expenses идемпотентно: сначала удаляем старую запись за этот
// business+date+source+category, потом вставляем свежую — иначе каждый
// часовой прогон будет плодить дубли (в expenses нет unique-констрейнта).
async function upsertExpense({ businessId, date, amount, category, source, description }) {
  await admin
    .from("expenses")
    .delete()
    .eq("business_id", businessId)
    .eq("date", date)
    .eq("source", source)
    .eq("category", category);

  if (amount > 0) {
    await admin.from("expenses").insert({
      business_id: businessId,
      amount,
      category,
      description,
      date,
      source,
    });
  }
}

async function main(businessId) {
  // ФІКС: той самий self-lockout, що і в sync-stripe-core.mjs — status:
  // "connected" в фільтрі означав, що інтеграція, яка хоч раз впала в
  // "error", більше ніколи не потрапляла в цей запит (ні в кроні, ні в
  // ручному "Sync now"), а тільки успішний прогін всередині циклу повертав
  // status назад на "connected". Один тимчасовий збій — і синк зупинявся
  // назавжди без ручного втручання. Тепер підбираємо і "error" теж, щоб
  // синк міг сам спробувати ще раз і сам відновити статус при успіху.
  let query = admin
    .from("integrations")
    .select("id, business_id, api_key_encrypted, config")
    .eq("provider", "shopify")
    .in("status", ["connected", "error"]);
  if (businessId) query = query.eq("business_id", businessId);
  const { data: integrations, error: fetchErr } = await query;

  if (fetchErr) {
    console.error("Failed to fetch shopify integrations:", fetchErr.message);
    return;
  }
  if (!integrations?.length) {
    console.log("No connected Shopify integrations, nothing to sync.");
    return;
  }

  const sinceIso = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

  for (const integ of integrations) {
    try {
      const shopDomain = normalizeShopDomain(integ.config?.shop_domain);
      if (!shopDomain) {
        throw new Error("Missing shop_domain in integration config");
      }
      const secretPayload = decrypt(integ.api_key_encrypted);
      const token = await resolveShopifyToken({
        shopDomain,
        secretPayload,
        clientId: integ.config?.client_id || null,
      });
      const orders = await fetchShopifyOrders(shopDomain, token, sinceIso);

      // Локальна дата бізнеса — той самий підхід, що вже застосований у
      // sync-stripe-core.mjs, щоб дати з обох джерел завжди збігались.
      const { data: bizRow } = await admin
        .from("businesses")
        .select("timezone")
        .eq("id", integ.business_id)
        .maybeSingle();
      const bizTimezone = bizRow?.timezone || "UTC";

      const byDate = {};
      for (const order of orders) {
        const date = localDateStr(bizTimezone, order.created_at);
        const shipping =
          Number(order.total_shipping_price_set?.shop_money?.amount) ||
          (order.shipping_lines || []).reduce((sum, l) => sum + (Number(l.price) || 0), 0);
        byDate[date] = (byDate[date] || 0) + shipping;
      }

      for (const [date, amount] of Object.entries(byDate)) {
        await upsertExpense({
          businessId: integ.business_id,
          date,
          amount: Number(amount.toFixed(2)),
          category: "shipping",
          source: "shopify",
          description: "Shopify shipping cost (auto-synced)",
        });
      }

      const cogsByDate = await computeCogsByDate(shopDomain, token, orders, bizTimezone);
      for (const [date, amount] of Object.entries(cogsByDate)) {
        await upsertExpense({
          businessId: integ.business_id,
          date,
          amount: Number(amount.toFixed(2)),
          category: "cogs",
          source: "shopify",
          description: "Shopify cost of goods (auto-synced)",
        });
      }

      // revenue_mode: "replace" (дефолт, чекбокс не відмічений при
      // підключенні) чи "add" (окремий потік грошей) — див. коментар біля
      // upsertShopifyRevenue вище.
      const revenueMode = integ.config?.revenue_mode === "add" ? "add" : "replace";
      const revenueByDate = computeRevenueByDate(orders, bizTimezone);
      const ordersCountByDate = {};
      for (const order of orders) {
        if (order.cancelled_at) continue;
        const date = localDateStr(bizTimezone, order.created_at);
        ordersCountByDate[date] = (ordersCountByDate[date] || 0) + 1;
      }
      for (const [date, revenue] of Object.entries(revenueByDate)) {
        await upsertShopifyRevenue({
          integrationId: integ.id,
          integrationConfig: integ.config || {},
          businessId: integ.business_id,
          date,
          revenue,
          orders: ordersCountByDate[date] || 0,
          revenueMode,
        });
      }

      // Перевіряємо аномалії тільки за останню (найсвіжішу) дату з вікна синку —
      // старіші дні вже перевірялись на попередніх прогонах. Умисно НЕ додаємо
      // окремий "order_volume_drop" — падіння продажів вже ловить revenue_drop
      // зі Stripe-синку, дублювати той самий сигнал іншими словами тільки додасть
      // зайвих сповіщень, а не користі.
      // Товарні залишки перевіряються лише для операційних сповіщень: вони не
      // впливають на фінансові метрики, графіки чи текст прогнозу. Відсутність
      // дозволу read_products не повинна зупиняти синхронізацію продажів.
      try {
        const lowStockVariants = await fetchLowStockVariants(shopDomain, token);
        if (lowStockVariants.length) {
          const contact = await getUserContact(await getBusinessUserId(integ.business_id));
          for (const item of lowStockVariants) {
            const displayName = item.variantTitle && item.variantTitle !== "Default Title"
              ? `${item.productTitle} — ${item.variantTitle}`
              : item.productTitle;
            const message = (LOW_STOCK_MESSAGE[contact.userLang] || LOW_STOCK_MESSAGE.EN)(displayName, item.quantity);
            await sendAlertToBusiness(integ.business_id, contact, {
              type: `low_stock_shopify_${item.id}`,
              severity: item.quantity === 0 ? "critical" : item.quantity <= 5 ? "medium" : "low",
              message,
              // На відміну від фінансових алертів (24h), тут довший cooldown:
              // власник вже побачив сповіщення, зв'язався з постачальником,
              // і поки товар їде — щоденне повторення того самого "закінчується"
              // тільки дратує, нової інформації воно не несе. Раз на тиждень
              // достатньо, щоб нагадати, якщо товар досі не поповнили.
              cooldownHours: 24 * 7,
            });
          }
        }
      } catch (inventoryError) {
        console.warn(`Shopify inventory check skipped for ${integ.id}:`, inventoryError.message);
      }

      const allDates = [...new Set([...Object.keys(byDate), ...Object.keys(cogsByDate)])].sort();
      if (allDates.length) {
        const latestDate = allDates[allDates.length - 1];
        const contact = await getUserContact(await getBusinessUserId(integ.business_id));
        const sensitivityMultiplier = await getAlertSensitivity(integ.business_id);

        if (byDate[latestDate] != null) {
          const anomaly = await detectExpenseAnomaly({
            businessId: integ.business_id,
            source: "shopify",
            category: "shipping",
            date: latestDate,
            todayAmount: byDate[latestDate],
            sensitivityMultiplier,
          });
          if (anomaly?.kind === "spike") {
            const msg = (SHIPPING_SPIKE_MESSAGE[contact.userLang] || SHIPPING_SPIKE_MESSAGE.EN)(anomaly.pct, anomaly.avg, anomaly.today, latestDate);
            const explanation = await generateAlertExplanation(
              contact.userLang,
              `Shopify shipping costs jumped ${anomaly.pct}% versus the 7-day average (from $${Math.round(anomaly.avg)} to $${Math.round(anomaly.today)}) on ${latestDate}.`
            );
            await sendAlertToBusiness(integ.business_id, contact, {
              type: "shipping_spike_shopify",
              severity: anomaly.pct >= 100 ? "high" : "medium",
              message: msg,
              aiExplanation: explanation,
            });
          }
        }

        if (cogsByDate[latestDate] != null) {
          const anomaly = await detectExpenseAnomaly({
            businessId: integ.business_id,
            source: "shopify",
            category: "cogs",
            date: latestDate,
            todayAmount: cogsByDate[latestDate],
            sensitivityMultiplier,
          });
          if (anomaly?.kind === "spike") {
            const msg = (COGS_SPIKE_MESSAGE[contact.userLang] || COGS_SPIKE_MESSAGE.EN)(anomaly.pct, anomaly.avg, anomaly.today, latestDate);
            const explanation = await generateAlertExplanation(
              contact.userLang,
              `Shopify cost of goods jumped ${anomaly.pct}% versus the 7-day average (from $${Math.round(anomaly.avg)} to $${Math.round(anomaly.today)}) on ${latestDate}. This directly compresses margin.`
            );
            await sendAlertToBusiness(integ.business_id, contact, {
              type: "cogs_spike_shopify",
              severity: anomaly.pct >= 100 ? "high" : "medium",
              message: msg,
              aiExplanation: explanation,
            });
          }
        }
      }

      const { sync_error_reason: _previousError, ...cleanConfig } = integ.config || {};
      await admin
        .from("integrations")
        .update({ last_synced_at: new Date().toISOString(), status: "connected", config: cleanConfig })
        .eq("id", integ.id);

      console.log(
        `Shopify synced business ${integ.business_id}: ${Object.keys(byDate).length} day(s) shipping, ${Object.keys(cogsByDate).length} day(s) cogs`
      );
    } catch (err) {
      console.error(`Failed to sync Shopify integration ${integ.id}:`, err.message);
      await logError({
        source: "shopify",
        message: `Sync failed for integration ${integ.id}`,
        details: err.message,
        businessId: integ.business_id,
      });
      // Помечаем интеграцию как проблемную (видно в /admin), но не отключаем —
      // синк для остальных интеграций продолжается благодаря try/catch на каждой.
      const reason = getSyncFailureReason(err);
      await admin
        .from("integrations")
        .update({ status: "error", config: { ...(integ.config || {}), sync_error_reason: reason } })
        .eq("id", integ.id);

      const contact = await getUserContact(await getBusinessUserId(integ.business_id));
      const msg = (SYNC_FAILURE_MESSAGE[contact.userLang] || SYNC_FAILURE_MESSAGE.EN)();
      const explanation = (SYNC_FAILURE_EXPLANATION[contact.userLang] || SYNC_FAILURE_EXPLANATION.EN)[reason];
      await sendAlertToBusiness(integ.business_id, contact, {
        type: "sync_failure_shopify",
        severity: "high",
        message: msg,
        aiExplanation: explanation,
      });
    }
  }
}

export async function runSync(businessId) {
  await main(businessId);
  return { synced: true, timestamp: new Date().toISOString() };
}
