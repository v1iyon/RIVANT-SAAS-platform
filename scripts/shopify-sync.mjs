// scripts/shopify-sync.mjs
//
// Этап 3 плана — sync-модуль для Shopify. Паттерн 1:1 с sync-stripe-core.mjs:
// расшифровать ключ -> запрос к API провайдера -> запись в expenses -> логирование ошибок.
//
// ВАЖНО про объём данных: сейчас пишем в expenses только СТОИМОСТЬ ДОСТАВКИ
// (shipping), потому что она прямо доступна в объекте заказа. Себестоимость
// товара (cost of goods) в Shopify лежит на уровне inventory_item.cost —
// это отдельный API-запрос на КАЖДЫЙ variant, сюда сознательно не включено,
// чтобы не плодить сотни лишних запросов на каждый синк. Можно добавить
// отдельным шагом позже, если понадобится.
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
  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/orders.json?status=any&created_at_min=${encodeURIComponent(sinceIso)}&limit=250&fields=id,created_at,shipping_lines,total_shipping_price_set`;
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

      await admin
        .from("integrations")
        .update({ last_synced_at: new Date().toISOString(), status: "connected" })
        .eq("id", integ.id);

      console.log(`Shopify synced business ${integ.business_id}: ${Object.keys(byDate).length} day(s)`);
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
