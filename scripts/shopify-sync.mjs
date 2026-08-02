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

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const SHOPIFY_API_VERSION = "2024-01";

function normalizeShopDomain(raw) {
  let domain = (raw || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!domain) return null;
  if (!domain.endsWith(".myshopify.com") && !domain.includes(".")) {
    domain = `${domain}.myshopify.com`;
  }
  return domain;
}

async function fetchShopifyOrders(shopDomain, token, sinceIso) {
  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/orders.json?status=any&created_at_min=${encodeURIComponent(sinceIso)}&limit=250&fields=id,created_at,shipping_lines,total_shipping_price_set,line_items`;
  const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Shopify API error: ${res.status} — ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  // Известное ограничение: если заказов >250 за окно синка, остальные не попадут
  // в этот прогон (нет пагинации). Для большинства маленьких магазинов это не
  // проблема при синке раз в час, но стоит иметь в виду при росте объёма.
  return data.orders || [];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
async function computeCogsByDate(shopDomain, token, orders) {
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
    const date = new Date(order.created_at).toISOString().slice(0, 10);
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
  let query = admin
    .from("integrations")
    .select("id, business_id, api_key_encrypted, config")
    .eq("provider", "shopify")
    .eq("status", "connected");
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
      const token = decrypt(integ.api_key_encrypted);
      const orders = await fetchShopifyOrders(shopDomain, token, sinceIso);

      const byDate = {};
      for (const order of orders) {
        const date = new Date(order.created_at).toISOString().slice(0, 10);
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

      const cogsByDate = await computeCogsByDate(shopDomain, token, orders);
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

      await admin
        .from("integrations")
        .update({ last_synced_at: new Date().toISOString(), status: "connected" })
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
      await admin.from("integrations").update({ status: "error" }).eq("id", integ.id);
    }
  }
}

export async function runSync(businessId) {
  await main(businessId);
  return { synced: true, timestamp: new Date().toISOString() };
}
