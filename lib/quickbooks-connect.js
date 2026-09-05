// lib/quickbooks-connect.js
//
// Записує результат OAuth-підключення QuickBooks Online у integrations —
// той самий формат, який очікує scripts/quickbooks-sync.mjs. На відміну
// від Google Ads тут немає окремого /finish-кроку з вибором акаунта:
// Intuit повертає РІВНО ОДИН realmId одразу в callback, тому
// finalizeQuickbooksConnection викликається прямо з
// app/api/auth/quickbooks/callback/route.js.
//
// QuickBooks НЕ проходить через app/api/connect-integration/route.js (той
// самий принцип, що і в google_ads OAuth-флоу — див. коментар у
// lib/google-ads-connect.js) — тому і перевірка тарифного слоту, і guard
// на конфлікт "replace" (lib/revenue-mode.js) повторюються тут явно, а не
// успадковуються від того роута.
// ФІКС/примітка: lib/revenue-mode.js написаний у ESM-синтаксисі (export
// const/function), тому цей файл теж тримається import/export, а не
// require()/module.exports, як lib/google-ads-connect.js — щоб уникнути
// сюрпризів з інтеропом CJS↔ESM. Обидва стилі однаково коректно
// збираються Next.js-бандлером у app/api/auth/quickbooks/callback/route.js,
// звідки ЄДИНО викликається ця функція (як і google-ads-connect.js, цей
// файл ніколи не імпортується напряму з .mjs cron-скриптів).
import { createClient } from "@supabase/supabase-js";
import { encrypt } from "./crypto.js";
import { downgradeConflictingReplaceProviders, effectiveRevenueMode } from "./revenue-mode";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const UNLIMITED_PLANS = ["scale", "trial"];

async function resolveBusinessAndUser(email) {
  const { data: user } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!user) throw new Error("user_not_found");

  const { data: business } = await admin.from("businesses").select("id").eq("user_id", user.id).maybeSingle();
  if (!business) throw new Error("business_profile_incomplete");

  return { userId: user.id, businessId: business.id };
}

async function assertQuickbooksSlotAllowed(userId) {
  const { data: sub } = await admin
    .from("subscriptions")
    .select("plan, integrations_selected")
    .eq("user_id", userId)
    .maybeSingle();

  if (!sub) throw new Error("no_active_subscription");
  if (UNLIMITED_PLANS.includes(sub.plan)) return;

  const selected = sub.integrations_selected || [];
  if (!selected.includes("quickbooks")) {
    throw new Error("integration_not_in_plan");
  }
}

async function finalizeQuickbooksConnection({ email, realmId, refreshToken }) {
  if (!email || !realmId || !refreshToken) {
    throw new Error("missing_connection_data");
  }

  const { userId, businessId } = await resolveBusinessAndUser(email);
  await assertQuickbooksSlotAllowed(userId);

  // "replace" за замовчуванням (чекбокс "окремий потік" зʼявляється лише
  // ПІСЛЯ підключення, у картці на дашборді — тут же немає проміжної форми,
  // OAuth-редирект іде одразу з кнопки). Той самий guard, що і в
  // app/api/connect-integration/route.js: якщо в бізнеса вже є інший
  // replace-провайдер (Shopify/WooCommerce), понижуємо його до "add" —
  // інакше обидва почнуть по черзі перезаписувати revenue за одну й ту ж
  // дату (див. lib/revenue-mode.js).
  const config = { realm_id: realmId, backfill_pending: true };
  const downgraded = await downgradeConflictingReplaceProviders(admin, businessId, "quickbooks", effectiveRevenueMode(config));

  const secretPayload = JSON.stringify({ refresh_token: refreshToken });
  const encrypted = encrypt(secretPayload);
  const keyPreview = `company ${realmId}`;

  const { data: existing } = await admin
    .from("integrations")
    .select("id")
    .eq("business_id", businessId)
    .eq("provider", "quickbooks")
    .maybeSingle();

  if (existing) {
    const { error } = await admin
      .from("integrations")
      .update({ api_key_encrypted: encrypted, status: "connected", key_preview: keyPreview, config })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin.from("integrations").insert({
      business_id: businessId,
      provider: "quickbooks",
      api_key_encrypted: encrypted,
      status: "connected",
      key_preview: keyPreview,
      config,
    });
    if (error) throw new Error(error.message);
  }

  return { businessId, downgraded };
}

export { finalizeQuickbooksConnection };
