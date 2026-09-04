// app/api/cron/backfill-historical/route.js
//
// Одноразовий бекфіл історії при (пере)підключенні інтеграції. Раніше
// синк (Stripe/Shopify/Meta Ads/Google Ads) завжди тягнув лише останні
// 48г — тобто дані накопичувались ТІЛЬКИ вперед від моменту підключення,
// і "Реконструкція минулого" ($199, продається як "12 міс. історії"),
// графіки за 3/6/12 місяців і дайджест фактично не мали за що рахувати
// старіші періоди, навіть якщо реальна історія в Stripe/Shopify/рекламних
// кабінетах є за роки.
//
// Тут — окремий крон, що бере ОДНУ інтеграцію з config.backfill_pending =
// true (виставляється в connect-integration, connect-stripe,
// google-ads-connect при (пере)підключенні) і тягне за неї до 365 днів
// історії тим самим sync-модулем, що й звичайний крон — просто з ширшим
// вікном (options.sinceDays). Обробка ПО ОДНІЙ інтеграції за прогін —
// навмисно: рік історії Stripe/Shopify/рекламного кабінету може бути
// тисячами записів, і краще кілька коротких безпечних прогонів під ліміт
// часу serverless-функції, ніж один довгий ризикований запит.
//
// п.9 аудита: раніше цей крон не викликався взагалі ніким (навіть кнопки в
// адмінці не було) — фіча "12 міс. історії" не спрацьовувала ніколи. Тепер
// викликається двічі на годину з того ж GitHub Actions job, що й звичайний
// синк (.github/workflows/sync-stripe.yml). При 1 інтеграції за прогін і
// 48 прогонах/добу цього з запасом вистачає для поточного обсягу клієнтів;
// якщо черга почне накопичуватись — збільшити .limit(1) нижче або кількість
// прогонів.
//
// Прапорець скидається в будь-якому разі (успіх чи ні) — щоб зависла
// інтеграція (наприклад, протермінований ключ) не блокувала чергу вічно;
// помилка йде в error_logs так само, як і в звичайному синку.
import { createClient } from "@supabase/supabase-js";
import { logError } from "../../../../lib/log-error.js";
import { isValidSecret } from "../../../../lib/verify-secret.js";
import { runSync as runStripeSync } from "../../../../scripts/sync-stripe-core.mjs";
import { runSync as runShopifySync } from "../../../../scripts/shopify-sync.mjs";
import { runSync as runWooCommerceSync } from "../../../../scripts/woocommerce-sync.mjs";
import { runSync as runMetaAdsSync } from "../../../../scripts/meta-ads-sync.mjs";
import { runSync as runGoogleAdsSync } from "../../../../scripts/google-ads-sync.mjs";
import { runSync as runPaypalSync } from "../../../../scripts/paypal-sync.mjs";

// Тот же пробел, что и в process-service-orders: maxDuration не был
// объявлен, а один прогон может тянуть до 365 дней истории из внешнего
// API. Теперь роут дергается автоматически (см.
// .github/workflows/sync-stripe.yml, п.9), поэтому таймаут без явного
// maxDuration будет повторяться на каждом прогоне, а не только при ручном
// клике. На Vercel Hobby жёсткий лимит 10с всё равно не обойти — см. п.6.
export const maxDuration = 60;

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// 365 днів — відповідає тому, що продає "AI-Реконструкція минулого"
// ("12 міс. історії"). Якщо в акаунта реальної історії менше — sync-модулі
// просто поверне менше рядків, це нормально (не помилка). PayPal сам API
// дозволяє тягнути аж 3 роки назад (перевірено по офіційній документації
// 03.09.2026, "lists transactions for the previous three years"), тож 365
// днів тут — свідоме обмеження продукту, а не стеля з боку PayPal.
const BACKFILL_SINCE_DAYS = 365;

const SYNC_BY_PROVIDER = {
  stripe: runStripeSync,
  shopify: runShopifySync,
  woocommerce: runWooCommerceSync,
  meta_ads: runMetaAdsSync,
  google_ads: runGoogleAdsSync,
  paypal: runPaypalSync,
};

async function clearBackfillFlag(integration) {
  const nextConfig = { ...(integration.config || {}), backfill_pending: false };
  await admin.from("integrations").update({ config: nextConfig }).eq("id", integration.id);
}

export async function GET(req) {
  // Раньше secret !== process.env.CRON_SECRET сравнивалось обычным ===
  // (и Vercel-вариант — обычным сравнением строк "Bearer ..."). Оба
  // заменены на константное по времени сравнение — см. lib/verify-secret.js
  // и п. 2.5 аудита.
  const secret = req.headers.get("x-cron-secret");
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;

  const validHeaderSecret = isValidSecret(secret, process.env.CRON_SECRET);
  const validVercelCron = isValidSecret(bearerToken, process.env.CRON_SECRET);

  if (!validHeaderSecret && !validVercelCron) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // contains() — фільтр по jsonb: тільки рядки, де config.backfill_pending === true.
  const { data: integrations, error } = await admin
    .from("integrations")
    .select("id, business_id, provider, status, config")
    .eq("status", "connected")
    .contains("config", { backfill_pending: true })
    .limit(1);

  if (error) {
    console.error("backfill-historical: fetch error", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!integrations?.length) {
    return Response.json({ processed: 0 });
  }

  const integ = integrations[0];
  const runSync = SYNC_BY_PROVIDER[integ.provider];
  if (!runSync) {
    // Провайдер без бекфілу (наприклад quickbooks/google_analytics, для
    // яких sync-модуля ще нема) — просто знімаємо прапорець, щоб не
    // залипати на ньому щоразу.
    await clearBackfillFlag(integ);
    return Response.json({ processed: 0, skipped: integ.provider });
  }

  try {
    await runSync(integ.business_id, { sinceDays: BACKFILL_SINCE_DAYS });
    await clearBackfillFlag(integ);
    return Response.json({ processed: 1, businessId: integ.business_id, provider: integ.provider });
  } catch (err) {
    console.error("backfill-historical: sync failed", integ.provider, integ.business_id, err);
    await logError({
      source: `backfill_${integ.provider}`,
      message: String(err.message || err),
      businessId: integ.business_id,
    });
    // Все одно знімаємо прапорець — інакше зламана інтеграція (протермінований
    // ключ тощо) блокує чергу для інших бізнесів назавжди. Звичайний
    // погодинний/подобовий крон продовжить пробувати синк за 48г вікном.
    await clearBackfillFlag(integ);
    return Response.json({ processed: 0, error: String(err.message || err) }, { status: 200 });
  }
}