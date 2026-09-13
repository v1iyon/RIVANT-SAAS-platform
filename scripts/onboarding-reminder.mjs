// scripts/onboarding-reminder.mjs
//
// Нагадування "завершіть онбординг", якщо бізнес зареєстрований вже
// REMINDER_AFTER_DAYS+ днів тому, але так і не підключив жодного джерела
// доходу (той самий критерій "integration", що й у
// app/api/onboarding-status/route.js — REVENUE_SOURCE_PROVIDERS з
// lib/plan-slots.js, щоб "підключено" тут означало те саме, що й у
// чек-листі на дашборді).
//
// Дедуп/одноразовість — через sendAlert() з lib/alerts.mjs: власний запис
// у alerts_log (type: "onboarding_incomplete_setup") + великий cooldown
// (COOLDOWN_HOURS), щоб конкретному бізнесу пішло щонайбільше один такий
// нагад, а не спам щогодини, поки крон крутиться. Якщо за COOLDOWN_HOURS
// бізнес так і не підключився — нагадає ще раз (не "тільки раз назавжди",
// а "не частіше, ніж раз на N днів, поки проблема не вирішена").
//
// Свідомо НЕ через sendAlertToBusiness (без фан-ауту команді) — це
// повідомлення для власника, який ще не завершив налаштування, команда
// тут ні до чого. І свідомо НЕ "ризик"/аномалія по суті, а разова
// підказка — тому severity: "low", а не "high"/"medium" як у
// revenue_drop/CAC-спайках.
import { createClient } from "@supabase/supabase-js";
import { sendAlert, getUserContact } from "../lib/alerts.mjs";
import { logError } from "../lib/log-error.js";
import { REVENUE_SOURCE_PROVIDERS } from "../lib/plan-slots.js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const REMINDER_AFTER_DAYS = 2; // раньше этого — не дёргаем, человек мог просто ещё не успеть
const COOLDOWN_HOURS = 24 * 7; // не чаще раза в неделю на один и тот же бизнес

const REMINDER_MESSAGE = {
  UA: (name) => Привіт! Помітили, що "${name}" ще не підключив(-ла) жодного джерела доходу — без цього прогнози й сповіщення про ризики не працюють. Заходьте в кабінет → "Інтеграції", це займає пару хвилин.,
  EN: (name) => Hey! We noticed "${name}" hasn't connected a revenue source yet — forecasts and risk alerts won't work without one. Head to the dashboard → "Integrations", it only takes a couple of minutes.,
  DE: (name) => Hallo! Uns ist aufgefallen, dass für "${name}" noch keine Umsatzquelle verbunden ist — ohne sie funktionieren Prognosen und Risiko-Warnungen nicht. Im Dashboard unter "Integrationen" dauert das nur ein paar Minuten.,
};

export async function runOnboardingReminder() {
  const cutoff = new Date(Date.now() - REMINDER_AFTER_DAYS * 24 * 3600 * 1000).toISOString();

  const { data: businesses, error: businessesErr } = await admin
    .from("businesses")
    .select("id, user_id, name, created_at")
    .lte("created_at", cutoff);
  if (businessesErr) {
    console.error("onboarding-reminder: failed to load businesses:", businessesErr.message);
    await logError({ source: "onboarding_reminder", message: "Failed to load businesses list", details: businessesErr.message });
    return { checked: 0, sent: 0 };
  }
  if (!businesses  !businesses.length) return { checked: 0, sent: 0 };

  // Дубли от гонки при создании бизнеса (см. lib/get-primary-business.ts) не
  // должны получать отдельное напоминание под своим (часто устаревшим)
  // именем — иначе владелец видит в Telegram напоминания, которые не
  // соответствуют тому, что он видит и переименовывает в кабинете. Кабинет
  // всегда работает с самым первым созданным бизнесом пользователя — здесь
  // повторяем ту же логику (не можем импортировать .ts-хелпер: этот скрипт
  // гоняется через обычный `node`, без ts-node/tsx).
  const userIds = [...new Set(businesses.map((b) => b.user_id))];
  const { data: allUserBusinesses } = await admin
    .from("businesses")
    .select("id, user_id, created_at")
    .in("user_id", userIds)
    .order("created_at", { ascending: true });

  const primaryIdByUser = new Map();
  for (const b of allUserBusinesses  []) {
    if (!primaryIdByUser.has(b.user_id)) primaryIdByUser.set(b.user_id, b.id);
  }

  let sent = 0;
  for (const business of businesses) {
    if (primaryIdByUser.get(business.user_id) !== business.id) continue; // не основной бизнес — пропускаем
    try {
      const { data: integrations } = await admin
        .from("integrations")
        .select("provider")
        .eq("business_id", business.id)
        .eq("status", "connected")
        .in("provider", REVENUE_SOURCE_PROVIDERS);

      // Уже есть хотя бы одна подключённая интеграция — этому бизнесу
      // напоминание не нужно, независимо от того, слали ли уже раньше.
      if (integrations && integrations.length > 0) continue;

      const contact = await getUserContact(business.user_id);
      if (!contact.telegramId && !(contact.emailEnabled && contact.email)) continue; // некому слать

      const messageFn = REMINDER_MESSAGE[contact.userLang]  REMINDER_MESSAGE.EN;
      const wasSent = await sendAlert({
        businessId: business.id,
        type: "onboarding_incomplete_setup",
        severity: "low",
        message: messageFn(business.name  "—"),
        userLang: contact.userLang,
        telegramId: contact.telegramId,
        email: contact.email,
        emailEnabled: contact.emailEnabled,
        cooldownHours: COOLDOWN_HOURS,
      });
      if (wasSent) sent += 1;
    } catch (err) {
      console.error(onboarding-reminder: failed for business ${business.id}:, err);
      await logError({ source: "onboarding_reminder", message: Failed for business ${business.id}, details: String(err) });
      // Не прерываем остальных — один сбойный бизнес не должен блокировать напоминания другим.
    }
  }

  return { checked: businesses.length, sent };
}