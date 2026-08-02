import { runSync as runStripeSync } from "./sync-stripe-core.mjs";
import { runSync as runShopifySync } from "./shopify-sync.mjs";
import { runSync as runMetaAdsSync } from "./meta-ads-sync.mjs";
import { runSync as runGoogleAdsSync } from "./google-ads-sync.mjs";

const jobs = [
  { name: "stripe", run: runStripeSync },
  { name: "shopify", run: runShopifySync },
  { name: "meta_ads", run: runMetaAdsSync },
  { name: "google_ads", run: runGoogleAdsSync },
];

let hadFailure = false;

for (const job of jobs) {
  try {
    const result = await job.run();
    console.log(`[${job.name}] Sync finished:`, result);
  } catch (err) {
    hadFailure = true;
    console.error(`[${job.name}] Sync failed:`, err);
    // Не прерываем остальные синки — ошибка одного провайдера не должна
    // блокировать данные для другого (см. ЕТАП 3, п.3 плана).
  }
}

process.exitCode = hadFailure ? 1 : 0;