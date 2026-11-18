// scripts/shopify-sync.mjs
//
// Sync-модуль для Shopify. Паттерн 1:1 с sync-stripe-core.mjs:
// получить токен -> запрос к API провайдера -> запись в expenses/metrics_computed -> логирование ошибок.
//
// ТОЛЬКО GraphQL Admin API (требование Shopify App Store для новых публичных приложений).
// Пишем в expenses СТОИМОСТЬ ДОСТАВКИ (shipping) и СЕБЕСТОИМОСТЬ ТОВАРА (cost_of_goods).
// Себестоимость берётся тем же запросом заказов: lineItems.variant.inventoryItem.unitCost —
// никаких доп. запросов на каждый variant и пауз под REST-лимит. Если unitCost у товара не
// заполнен в Shopify, строка пропускается (посчитать нельзя — это не баг). Если у токена нет
// доступа к unitCost (ACCESS_DENIED), синк продолжается без себестоимости, а не падает —
// в этом случае добавьте scope read_inventory.
//
// Токен: интеграции, подключённые через OAuth (config.auth === "oauth"), берут токен через
// getValidAccessToken() (шифрование + авто-refresh). Старые интеграции с ручным ключом
// продолжают работать через resolveShopifyToken() до миграции клиентов.
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../lib/crypto.js";
import { logError } from "../lib/log-error.js";
import { resolveShopifyToken } from "../lib/shopify-token.mjs";
import { getValidAccessToken } from "../lib/shopify/server.mjs";
import { sendAlertToBusiness, getUserContact, generateAlertExplanation, detectExpenseAnomaly, getAlertSensitivity } from "../lib/alerts.mjs";

const SYNC_FAILURE_MESSAGE = {
  UA: () => `Не вдалося синхронізувати Shopify`,
  EN: () => `Failed to sync Shopify`,
  DE: () => `Shopify Synchronisierung fehlgeschlagen`,
};

function getSyncFailureReason(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("app_not_installed") || message.includes("not connected")) return "app_not_installed";
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

const LOW_STOCK_MESSAGE = {
  UA: (name, quantity) => `Низький залишок: «${name}» — ${quantity} шт.`,
  EN: (name, quantity) => `Low stock: “${name}” — ${quantity} units.`,
  DE: (name, quantity) => `Niedriger Bestand: „${name}“ — ${quantity} Stück.`,
};

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-10";
const LOW_STOCK_THRESHOLD = 20;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ФІКС: дати рахуються по локальному timezone бізнесу (як у sync-stripe-core.mjs),
// а не по UTC — інакше замовлення біля межі дня потрапляли в не той стовпчик графіка.
function localDateStr(tz, dateInput) {
  const d = typeof dateInput === "string" || typeof dateInput === "number" ? new Date(dateInput) : dateInput;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC" }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(d);
  }
}

// ФІКС (аудит #2, знахідка №5 — SSRF): приймаємо ТІЛЬКИ валідний *.myshopify.com хостнейм.
// Все інше — null, і виклик трактує null як помилку підключення, а не намагається синкати.
function normalizeShopDomain(raw) {
  let domain = (raw || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!domain) return null;
  if (!domain.includes(".")) {
    domain = `${domain}.myshopify.com`;
  }
  const valid = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain);
  return valid ? domain : null;
}

// Числовой ID из GID вида "gid://shopify/Order/123456" (нужен для стабильных ключей алертов).
function extractNumericId(gid) {
  if (!gid) return null;
  const match = String(gid).match(/(\d+)$/);
  return match ? Number(match[1]) : null;
}

// ---------- GraphQL ----------
async function gqlRequest(shopDomain, token, query, variables) {
  const res = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Shopify API error: ${res.status} — ${body.slice(0, 300)}`);
  }
  return res.json();
}

const hasCode = (errors, code) => (errors || []).some((e) => e.extensions?.code === code);

// ВАЖНО: запит навмисно не торкається customer, email, shippingAddress, billingAddress та інших
// protected-полів — Shopify гейтить Protected Customer Data на рівні ПОЛІВ у GraphQL, тож цей
// запит працює без Protected Customer Data approval.
function ordersQuery(includeCost) {
  return `
  query GetOrders($cursor: String, $searchQuery: String!, $pageSize: Int!) {
    orders(first: $pageSize, after: $cursor, query: $searchQuery, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          createdAt
          cancelledAt
          currentTotalPriceSet { shopMoney { amount } }
          totalShippingPriceSet { shopMoney { amount } }
          shippingLines(first: 10) { edges { node { originalPriceSet { shopMoney { amount } } } } }
          lineItems(first: 50) {
            edges { node { quantity variant { id${includeCost ? " inventoryItem { unitCost { amount } }" : ""} } } }
          }
        }
      }
    }
  }`;
}

async function fetchShopifyOrders(shopDomain, token, sinceIso) {
  const searchQuery = `created_at:>='${sinceIso}'`;

  let allOrders = [];
  let cursor = null;
  let hasNextPage = true;
  let includeCost = true;
  let pageSize = 50; // при MAX_COST_EXCEEDED автоматически уменьшаем
  let throttles = 0;
  let pageGuard = 0; // защита от бесконечного цикла

  while (hasNextPage && pageGuard < 200) {
    pageGuard += 1;
    const data = await gqlRequest(shopDomain, token, ordersQuery(includeCost), { cursor, searchQuery, pageSize });

    if (data.errors) {
      if (hasCode(data.errors, "THROTTLED") && throttles < 10) {
        throttles += 1;
        await sleep(2000);
        continue;
      }
      if (hasCode(data.errors, "MAX_COST_EXCEEDED") && pageSize > 5) {
        pageSize = Math.max(5, Math.floor(pageSize / 2));
        continue;
      }
      if (includeCost && hasCode(data.errors, "ACCESS_DENIED")) {
        console.warn(`Shopify ${shopDomain}: no access to inventoryItem.unitCost — cost of goods skipped (add read_inventory scope)`);
        includeCost = false;
        cursor = null;
        allOrders = [];
        hasNextPage = true;
        continue;
      }
      throw new Error(`Shopify GraphQL error: ${JSON.stringify(data.errors).slice(0, 300)}`);
    }

    const ordersPage = data.data?.orders;
    if (!ordersPage) break;

    for (const { node } of ordersPage.edges) {
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
        line_items: (node.lineItems?.edges || []).map((e) => {
          const raw = e.node.variant?.inventoryItem?.unitCost?.amount;
          const unitCost = raw == null ? null : Number(raw);
          return {
            quantity: e.node.quantity,
            variant_id: extractNumericId(e.node.variant?.id),
            unit_cost: Number.isFinite(unitCost) ? unitCost : null,
          };
        }),
      });
    }

    hasNextPage = ordersPage.pageInfo?.hasNextPage ?? false;
    cursor = ordersPage.pageInfo?.endCursor ?? null;
  }

  return allOrders;
}

const LOW_STOCK_QUERY = `
  query LowStock($cursor: String, $pageSize: Int!) {
    products(first: $pageSize, after: $cursor, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          title
          variants(first: 50) {
            edges { node { id title inventoryQuantity inventoryItem { tracked } } }
          }
        }
      }
    }
  }
`;

// Остатки нужны только для операционных алертов; ошибка здесь не должна ронять синк продаж
// (main() ловит её отдельно). Варианты сверх первых 50 у одного товара не проверяются.
async function fetchLowStockVariants(shopDomain, token) {
  const lowStock = [];
  let cursor = null;
  let hasNextPage = true;
  let pageSize = 20;
  let throttles = 0;
  let pageGuard = 0;

  while (hasNextPage && pageGuard < 200) {
    pageGuard += 1;
    const data = await gqlRequest(shopDomain, token, LOW_STOCK_QUERY, { cursor, pageSize });

    if (data.errors) {
      if (hasCode(data.errors, "THROTTLED") && throttles < 10) {
        throttles += 1;
        await sleep(2000);
        continue;
      }
      if (hasCode(data.errors, "MAX_COST_EXCEEDED") && pageSize > 3) {
        pageSize = Math.max(3, Math.floor(pageSize / 2));
        continue;
      }
      throw new Error(`Shopify GraphQL error: ${JSON.stringify(data.errors).slice(0, 300)}`);
    }

    const page = data.data?.products;
    if (!page) break;

    for (const { node: product } of page.edges) {
      for (const { node: variant } of product.variants?.edges || []) {
        const quantity = Number(variant.inventoryQuantity);
        if (variant.inventoryItem?.tracked && Number.isFinite(quantity) && quantity < LOW_STOCK_THRESHOLD) {
          lowStock.push({ id: extractNumericId(variant.id), productTitle: product.title, variantTitle: variant.title, quantity });
        }
      }
    }

    hasNextPage = page.pageInfo?.hasNextPage ?? false;
    cursor = page.pageInfo?.endCursor ?? null;
  }
  return lowStock;
}

// current_total_price — це вже фактична сума ПІСЛЯ повернень/часткових рефандів.
// Скасовані замовлення (cancelled_at заповнений) прибираємо повністю — це не дохід.
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

// Себестоимость по заказам окна синка — unit_cost уже пришёл в самом заказе.
function computeCogsByDate(orders, tz) {
  const byDate = {};
  for (const order of orders) {
    const date = localDateStr(tz, order.created_at);
    let orderCogs = 0;
    for (const li of order.line_items || []) {
      if (li.unit_cost == null) continue; // нет данных о себестоимости — пропускаем, не выдумываем
      orderCogs += li.unit_cost * (Number(li.quantity) || 0);
    }
    if (orderCogs > 0) byDate[date] = (byDate[date] || 0) + orderCogs;
  }
  return byDate;
}

async function getBusinessUserId(businessId) {
  const { data } = await admin.from("businesses").select("user_id").eq("id", businessId).maybeSingle();
  return data?.user_id ?? null;
}

// Записує дохід із Shopify-замовлень у metrics_computed — ту саму таблицю, яку
// sync-stripe-core.mjs заповнює зі Stripe. Один рядок на business+date, тому read-modify-write.
// revenue_mode:
//   "replace" (дефолт) — Shopify єдине джерело revenue за дату (гроші вже пройшли через Stripe
//     всередині Shopify Checkout — складання дало б задвоєння).
//   "add" — магазин є окремим потоком грошей — додаємо до того, що вже є в рядку.
//
// ФІКС (задвоєння в режимі "add"): `revenue` — це ЗАВЖДИ повна сума за дату, порахована
// наново (вікно 48h перечитується щогодини). Тому в integrations.config.shopify_revenue_memo
// пам'ятаємо, що МИ додали за кожну дату, і додаємо лише РІЗНИЦЮ. Мапа обрізається до 3 днів.
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
    else integrationConfig.shopify_revenue_memo = updatedMemo; // in-memory config актуальний для наступних дат
  }
}

// Пишем в expenses идемпотентно: удаляем старую запись за business+date+source+category,
// потом вставляем свежую (в expenses нет unique-констрейнта).
async function upsertExpense({ businessId, date, amount, category, source, description }) {
  await admin
    .from("expenses")
    .delete()
    .eq("business_id", businessId)
    .eq("date", date)
    .eq("source", source)
    .eq("category", category);

  if (amount > 0) {
    // ФІКС (аудит 03.09.2026): помилка .insert() раніше ігнорувалась (constraint на category
    // мовчки губив COGS). Тепер будь-яка помилка вставки потрапляє в error_logs.
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
        source: "shopify",
        message: `expenses insert failed: ${category}/${source}`,
        details: error.message,
        businessId,
      });
    }
  }
}

async function main(businessId) {
  // ФІКС (self-lockout): підбираємо і "error" теж, щоб синк міг сам відновитись після збою.
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

      let token;
      if (integ.config?.auth === "oauth") {
        token = await getValidAccessToken(shopDomain); // расшифровка + авто-refresh
      } else {
        // Legacy: ручной ключ (оставлено до миграции существующих клиентов на OAuth)
        const secretPayload = decrypt(integ.api_key_encrypted);
        token = await resolveShopifyToken({
          shopDomain,
          secretPayload,
          clientId: integ.config?.client_id || null,
        });
      }

      const orders = await fetchShopifyOrders(shopDomain, token, sinceIso);

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

      const cogsByDate = computeCogsByDate(orders, bizTimezone);
      // category ДОЛЖНА быть 'cost_of_goods' (CHECK на public.expenses.category:
      // 'advertising' | 'shipping' | 'cost_of_goods' | 'other').
      for (const [date, amount] of Object.entries(cogsByDate)) {
        await upsertExpense({
          businessId: integ.business_id,
          date,
          amount: Number(amount.toFixed(2)),
          category: "cost_of_goods",
          source: "shopify",
          description: "Shopify cost of goods (auto-synced)",
        });
      }

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

      // Товарні залишки — лише операційні сповіщення; відсутність доступу до товарів
      // не повинна зупиняти синхронізацію продажів.
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
              // Довший cooldown (раз на тиждень): власник уже побачив сповіщення.
              cooldownHours: 24 * 7,
            });
          }
        }
      } catch (inventoryError) {
        console.warn(`Shopify inventory check skipped for ${integ.id}:`, inventoryError.message);
      }

      // Аномалії — лише за останню дату вікна синку. Окремий "order_volume_drop" не додаємо:
      // падіння продажів вже ловить revenue_drop зі Stripe-синку.
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
            category: "cost_of_goods",
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

      // Синхронизируем статус OAuth-подключения (для индикатора в дашборде)
      if (integ.config?.auth === "oauth") {
        await admin
          .from("shopify_connections")
          .update({ sync_status: "done", last_sync_at: new Date().toISOString() })
          .eq("shop_domain", shopDomain);
      }

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
