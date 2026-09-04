import { NextResponse } from "next/server";
import { isValidSecret } from "@/lib/verify-secret";

export const maxDuration = 60; // на Hobby-плане Vercel лимит 60s, на Pro можно больше

export async function GET(req) {
  // Защита от чужих вызовов — Vercel Cron сам добавляет этот заголовок.
  // Timing-safe сравнение — см. lib/verify-secret.js и п. 2.5 аудита.
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  if (!isValidSecret(bearerToken, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    // This endpoint is the production fallback for deployments where GitHub
    // Actions is not configured. Previously it ran Stripe only, leaving
    // connected Shopify and Google Ads accounts permanently stale.
    //
    // ВАЖЛИВО: раніше цей fallback синкав дані, але НЕ викликав
    // runDailyReports() — якщо GitHub Actions коли-небудь не відпрацював
    // (ліміт хвилин, збій, автовимкнення воркфлоу через неактивність
    // репозиторію тощо), ранковий/вечірній дайджест не йшов взагалі НІКУДИ,
    // без жодного фолбеку і без жодного сигналу, що щось зламалось. Тепер
    // цей маршрут — справжній fallback, а не лише "half fallback".
    const [stripe, shopify, woocommerce, metaAds, googleAds, paypal, dailyReports] = await Promise.allSettled([
      import("../../../../scripts/sync-stripe-core.mjs").then(({ runSync }) => runSync()),
      import("../../../../scripts/shopify-sync.mjs").then(({ runSync }) => runSync()),
      import("../../../../scripts/woocommerce-sync.mjs").then(({ runSync }) => runSync()),
      import("../../../../scripts/meta-ads-sync.mjs").then(({ runSync }) => runSync()),
      import("../../../../scripts/google-ads-sync.mjs").then(({ runSync }) => runSync()),
      import("../../../../scripts/paypal-sync.mjs").then(({ runSync }) => runSync()),
      import("../../../../scripts/daily-reports.mjs").then(({ runDailyReports }) => runDailyReports()),
    ]);
    const results = { stripe, shopify, woocommerce, metaAds, googleAds, paypal, dailyReports };
    const failed = Object.entries(results)
      .filter(([, result]) => result.status === "rejected")
      .map(([provider]) => provider);

    return NextResponse.json({ ok: failed.length === 0, failed, results });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}