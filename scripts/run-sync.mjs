import { runSync as runStripeSync } from "./sync-stripe-core.mjs";
import { runSync as runShopifySync } from "./shopify-sync.mjs";
import { runSync as runWooCommerceSync } from "./woocommerce-sync.mjs";
import { runSync as runMetaAdsSync } from "./meta-ads-sync.mjs";
import { runSync as runGoogleAdsSync } from "./google-ads-sync.mjs";
import { runSync as runPaypalSync } from "./paypal-sync.mjs";
import { runSync as runMollieSync } from "./mollie-sync.mjs";
import { runSync as runQuickbooksSync } from "./quickbooks-sync.mjs";
import { runDailyReports } from "./daily-reports.mjs";

const jobs = [
  { name: "stripe", run: runStripeSync },
  { name: "shopify", run: runShopifySync },
  { name: "woocommerce", run: runWooCommerceSync },
  { name: "meta_ads", run: runMetaAdsSync },
  { name: "google_ads", run: runGoogleAdsSync },
  { name: "paypal", run: runPaypalSync },
  { name: "mollie", run: runMollieSync },
  { name: "quickbooks", run: runQuickbooksSync },
  // Гоняется щогодини разом з рештою — сам вирішує всередині, чи зараз 08:00
  // або 20:00 за Києвом, і чи вже не слав сьогодні (див. daily-reports.mjs).
  { name: "daily_reports", run: runDailyReports },
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