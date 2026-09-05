// lib/revenue-mode.js
//
// ПРОБЛЕМА, яку цей файл закриває: revenue_mode: "replace" (Shopify чи
// WooCommerce) означає "цей провайдер — ЄДИНЕ джерело revenue за дату" —
// upsertShopifyRevenue/upsertWooCommerceRevenue пишуть revenue: finalRevenue
// = сума ЛИШЕ цього провайдера, повністю перезаписуючи те, що вже лежало в
// metrics_computed.revenue за цю дату (див. scripts/shopify-sync.mjs,
// scripts/woocommerce-sync.mjs). Якщо ДВА провайдери одночасно в режимі
// "replace" (напр. Growth-план, клієнт обрав і Shopify, і WooCommerce як
// свої 2 слоти, і жоден не поставив чекбокс "окремий потік") — кожен
// прогін cron/sync-now перезаписує рядок повністю: хто відсинкався
// останнім, той і лишився в БД, дохід другого магазину за цю дату мовчки
// зникає. Це не помітно у UI (обидві картки показують "Підключено") і не
// падає жодною помилкою — просто дані тихо неправильні.
//
// РІШЕННЯ: на рівні бізнесу "replace" може бути щонайбільше в ОДНОГО з
// REPLACE_TOGGLE_PROVIDERS одночасно. Коли провайдер переходить у "replace"
// (явно через /api/integration-revenue-mode, або за замовчуванням при
// підключенні — дефолт "replace", якщо чекбокс не показаний/не відмічений),
// будь-який ІНШИЙ провайдер з цього списку, що вже "replace", автоматично
// понижується до "add" — так дані завжди узгоджені (сума не губиться, лише
// починає додаватись, а не заміщувати), а не залежать від того, який синк
// прогнався останнім. Виклик на боці мусить повернути `downgraded` клієнту,
// щоб UI показав явне пояснення, а не тиха зміна поведінки іншої картки.
//
// PayPal свідомо НЕ в цьому списку — його sync завжди "add" (див.
// REVENUE_SOURCE_PROVIDERS у lib/plan-slots.js, коментар при paypal).
// Stripe теж не в списку — в нього немає власного revenue_mode-перемикача,
// це завжди базовий рядок, який Shopify/WooCommerce або заміщують, або
// доповнюють.
export const REPLACE_TOGGLE_PROVIDERS = ["shopify", "woocommerce", "quickbooks"];

// Той самий дефолт, що і в sync-скриптах: revenue_mode відсутній у config
// -> трактуємо як "replace" (безпечний дефолт проти задвоєння доходу,
// коли Shopify/WooCommerce Checkout працює через уже підключений Stripe).
export function effectiveRevenueMode(config) {
  return config?.revenue_mode === "add" ? "add" : "replace";
}

// admin — вже автентифікований supabase-js service-role клієнт (передається
// викликаючим роутом, тут своєї копії не створюємо, щоб не плодити
// підключення). businessId — бізнес, у межах якого шукаємо конфлікт.
// provider — той, що ЗАРАЗ переходить у requestedMode. Повертає масив
// provider-кодів, яких довелось понизити до "add" (зазвичай 0 або 1 — але
// код не покладається на це і на всяк випадок обробляє всіх знайдених).
export async function downgradeConflictingReplaceProviders(admin, businessId, provider, requestedMode) {
  if (requestedMode !== "replace") return [];

  const others = REPLACE_TOGGLE_PROVIDERS.filter((p) => p !== provider);
  if (!others.length) return [];

  const { data: rows, error } = await admin
    .from("integrations")
    .select("id, provider, config")
    .eq("business_id", businessId)
    .in("provider", others);
  if (error) {
    console.error("downgradeConflictingReplaceProviders: failed to read integrations", error.message);
    return [];
  }

  const conflicting = (rows || []).filter((row) => effectiveRevenueMode(row.config) === "replace");
  const downgraded = [];
  for (const row of conflicting) {
    const nextConfig = { ...(row.config || {}), revenue_mode: "add" };
    const { error: updateErr } = await admin.from("integrations").update({ config: nextConfig }).eq("id", row.id);
    if (updateErr) {
      console.error(`downgradeConflictingReplaceProviders: failed to downgrade ${row.provider}`, updateErr.message);
      continue;
    }
    downgraded.push(row.provider);
  }
  return downgraded;
}
