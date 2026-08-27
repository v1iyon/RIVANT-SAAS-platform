// lib/ensure-trial.js
//
// ФІКС (аудит #2, знахідка №14): "створити триал, якщо його нема" раніше
// існувало трьома окремими копіями — app/api/subscription-status/route.js,
// app/api/telegram-connect/route.js і, за словами старого аудиту, ще й у
// auth-sync (там на момент цього фіксу вже прибрано). Дублювання само по
// собі не діра (в обох місцях є requireUser()), але при наступній зміні
// тривалості триала чи умов його створення є реальний шанс поправити
// одну копію і забути про іншу — рівно та проблема, що вже сталась з
// маржею (знахідка №1). Тепер обидва місця викликають цю ЄДИНУ функцію.
//
// Навмисно НЕ перевіряє/не створює appUser — це відповідальність
// викликача (у обох місцях логіка "знайти чи створити users" трохи
// різна: subscription-status ніколи не створює users, а telegram-connect
// створює). ensureTrial() відповідає ЛИШЕ за "чи є в цього user_id
// підписка, і якщо нема — створити trial".

const { createClient } = require("@supabase/supabase-js");

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Створює trial-підписку для user_id, якщо в нього ще жодної немає.
 * Якщо підписка вже є — повертає її як є, нічого не змінюючи (не скидає
 * плановий/платний статус назад до trial).
 *
 * @param {string} userId - public.users.id
 * @returns {Promise<{ sub: { plan: string, access_status: string, current_period_end: string } | null, error: string | null }>}
 */
async function ensureTrial(userId) {
  const { data: existing, error: fetchErr } = await admin
    .from("subscriptions")
    .select("plan, access_status, current_period_end")
    .eq("user_id", userId)
    .maybeSingle();

  if (fetchErr) {
    console.error("ensureTrial: failed to check existing subscription:", fetchErr.message);
    return { sub: null, error: fetchErr.message };
  }

  if (existing) {
    return { sub: existing, error: null };
  }

  const periodEnd = new Date(Date.now() + TRIAL_DURATION_MS).toISOString();
  const { data: created, error: insertErr } = await admin
    .from("subscriptions")
    .insert({
      user_id: userId,
      plan: "trial",
      access_status: "trial",
      current_period_end: periodEnd,
    })
    .select("plan, access_status, current_period_end")
    .maybeSingle();

  if (insertErr) {
    console.error("ensureTrial: failed to create trial subscription:", insertErr.message);
    return { sub: null, error: insertErr.message };
  }

  return { sub: created, error: null };
}

module.exports = { ensureTrial, TRIAL_DURATION_MS };
