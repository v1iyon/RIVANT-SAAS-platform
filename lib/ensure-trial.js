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
//
// ФІКС (05.09.2026, безлімітний триал через видалення акаунта): раніше
// перевірка "чи вже був триал" трималась ВИКЛЮЧНО на user_id — а саме
// user_id (разом з усією таблицею subscriptions) повністю стирається в
// app/api/delete-account/route.js. Людина видаляла акаунт одразу після
// закінчення 14 днів, реєструвалась на той самий email заново — отримувала
// новий user_id, у якого "ще жодної підписки немає", і чесно новий
// 14-денний триал. Так до нескінченності.
//
// Тепер факт "цей email вже отримував триал" живе окремо, у таблиці
// used_trial_emails (миграция 20260905000000_trial_abuse_prevention.sql),
// яку delete-account НІКОЛИ не чіпає — саме тому, що її і заводили для
// того, щоб пережити видалення акаунта. Зберігаємо не сам email, а його
// sha256-хеш — досить, щоб впізнати повторну спробу, але з самого запису
// неможливо відновити адресу.
//
// Обмеження (свідомо не вирішуємо тут): це не захищає від
// name+tag@gmail.com / name.with.dots@gmail.com — тег і крапки в Gmail
// ігноруються поштовим сервером, але для нас це різні email-рядки, а отже
// різні хеші. Якщо зловживання цим стане реальною проблемою — знадобиться
// окрема нормалізація адрес перед хешуванням, тут її поки немає.

const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

function hashEmail(email) {
  return crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

/**
 * Створює trial-підписку для user_id, якщо в нього ще жодної немає —
 * АЛЕ тільки якщо цей email ще жодного разу не отримував триал раніше
 * (перевірка по used_trial_emails, яка переживає видалення акаунта).
 * Якщо підписка вже є — повертає її як є, нічого не змінюючи (не скидає
 * плановий/платний статус назад до trial).
 *
 * @param {string} userId - public.users.id
 * @param {string} email - email користувача (потрібен для антифрод-перевірки,
 *   не зберігається в жодному вигляді, окрім sha256-хешу)
 * @returns {Promise<{ sub: { plan: string, access_status: string, current_period_end: string } | null, error: string | null }>}
 */
async function ensureTrial(userId, email) {
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

  const emailHash = email ? hashEmail(email) : null;
  let alreadyUsedTrial = false;

  if (emailHash) {
    const { data: usedRow, error: usedFetchErr } = await admin
      .from("used_trial_emails")
      .select("id")
      .eq("email_hash", emailHash)
      .maybeSingle();

    if (usedFetchErr) {
      // Не блокируем создание подписки из-за сбоя антифрод-проверки —
      // безопаснее временно дать честный триал, чем сломать онбординг
      // всем новым пользователям при временной проблеме с БД.
      console.error("ensureTrial: failed to check used_trial_emails:", usedFetchErr.message);
    } else if (usedRow) {
      alreadyUsedTrial = true;
    }
  }

  if (alreadyUsedTrial) {
    // Точно та сама "форма" стану, що й у /api/subscription-status для
    // ЕСТЕСТВЕННО закінченого триала (plan: null, access_status: "expired",
    // current_period_end: null) — завдяки цьому весь наявний UI/гейтинг
    // ("триал закінчився, оберіть план", 0 слотів інтеграцій і т.д.) працює
    // без жодних змін, нову підписку просто одразу створюємо в цьому стані.
    const { data: created, error: insertErr } = await admin
      .from("subscriptions")
      .insert({
        user_id: userId,
        plan: null,
        access_status: "expired",
        current_period_end: null,
      })
      .select("plan, access_status, current_period_end")
      .maybeSingle();

    if (insertErr) {
      console.error("ensureTrial: failed to create post-trial subscription:", insertErr.message);
      return { sub: null, error: insertErr.message };
    }

    return { sub: created, error: null };
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

  if (emailHash) {
    // Пишемо ПІСЛЯ успішного створення триала, а не до — якщо insert вище
    // впав з помилкою, людина не отримала триал взагалі, і не варто
    // "спалювати" її email на майбутнє за спробу, яка не вдалась.
    const { error: markUsedErr } = await admin
      .from("used_trial_emails")
      .insert({ email_hash: emailHash, first_trial_started_at: new Date().toISOString() });
    // Гонка (два паралельних запити одночасно) чи вже існуючий рядок —
    // не критично, ігноруємо: unique-constraint на email_hash не дасть
    // задублювати, а сам факт "триал видано" вже зафіксовано в subscriptions.
    if (markUsedErr && markUsedErr.code !== "23505") {
      console.error("ensureTrial: failed to record used_trial_emails:", markUsedErr.message);
    }
  }

  return { sub: created, error: null };
}

module.exports = { ensureTrial, TRIAL_DURATION_MS };
