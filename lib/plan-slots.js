// lib/plan-slots.js
//
// Единый источник правды о том, сколько слотов интеграций даёт каждый
// тариф, и какие провайдеры считаются "источником выручки" (обязателен
// хотя бы один в непустом выборе — иначе metrics_computed нечем
// заполнять: маржа, CAC, revenue_drop, дневные отчёты считаются только от
// выручки, которую пишут stripe-sync/shopify-sync).
//
// ВАЖНО: раньше эта же логика (кто сколько слотов получает) отдельно
// хардкодилась и в бэкенде (app/api/integrations-select/route.js,
// connect-integration, connect-stripe, lib/google-ads-connect.js), и во
// фронтенд-карточках (integration-connect-card.tsx, stripe-connect-card.tsx)
// — причём во фронтенде своей собственной, устаревшей версией
// (SINGLE_PICK_TIERS = ["growth"], planTier === "starter" всегда
// заблокировано). Когда бэкенд обновили под "Starter = 1 слот, Stripe или
// Shopify", карточки остались со старой логикой — Shopify показывал замок
// "доступно только на Growth", хотя бэкенд его уже разрешал и интеграция
// реально работала и синкалась. Теперь это один файл: изменение тарифной
// сетки делается один раз здесь, а не вручную синхронизируется в 4-5
// местах (см. историю бага — components/dashboard/integration-connect-card.tsx).
export const PLAN_SLOTS = {
  starter: 1,
  growth: 2,
  // scale/trial намеренно отсутствуют тут — они "безлимитные", см.
  // isUnlimitedPlan/getMaxSlots ниже (Infinity неудобно гонять через JSON
  // API-ответы, поэтому там отдельно возвращается null).
};

export const UNLIMITED_PLANS = ["scale", "trial"];

export const REVENUE_SOURCE_PROVIDERS = ["stripe", "shopify"];

export function isUnlimitedPlan(plan) {
  return !!plan && UNLIMITED_PLANS.includes(plan);
}

// undefined -> план неизвестен / нет активной подписки (0 слотов, полная
// блокировка). null -> безлимит (Scale/Trial). число -> точное количество
// слотов (Starter/Growth).
export function getMaxSlots(plan) {
  if (!plan) return undefined;
  if (isUnlimitedPlan(plan)) return null;
  return PLAN_SLOTS[plan];
}

// Общая для ВСЕХ карточек (Stripe/Shopify/Meta Ads/Google Ads) проверка:
// заблокирована ли эта конкретная карточка провайдера, и почему.
//   "expired"   — трайл закончился, доступа нет вообще.
//   "plan"      — тариф неизвестен/неактивен, слотов нет вообще.
//   "selection" — слоты есть, но все уже заняты ДРУГИМИ провайдерами.
//   null        — не заблокировано (либо есть свободный слот, либо это
//                 уже занятый ИМЕННО этим provider слот).
export function getIntegrationLockReason({ isExpiredTrial, planTier, selectedProviders, provider }) {
  if (isExpiredTrial) return "expired";
  const maxSlots = getMaxSlots(planTier);
  if (maxSlots === undefined) return "plan";
  if (maxSlots === null) return null; // Scale/Trial — безлимит
  const selected = selectedProviders || [];
  if (selected.length >= maxSlots && !selected.includes(provider)) return "selection";
  return null;
}