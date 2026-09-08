// lib/cron-heartbeat.mjs
//
// Делает "здоровье" крона видимым (см. supabase/migrations/20260908000000_cron_heartbeat.sql).
// Основной источник расписания — внешний cron-job.org, каждые 15 минут
// (см. .github/workflows/sync-stripe.yml). Резервный — нативный GitHub
// `schedule:` раз в час. Раньше если cron-job.org замолкал, единственным
// способом это заметить было вручную зайти в его личный кабинет — здесь
// же ничего не менялось: часовой fallback продолжал молча отрабатывать,
// создавая иллюзию "всё в порядке", хотя реальная частота синка падала с
// 15 минут до часа.
//
// checkAndAlertIfLate() вызывается В НАЧАЛЕ каждого прогона run-sync.mjs,
// ДО того как этот прогон перезапишет heartbeat своим временем — то есть
// сравнивает "когда был предыдущий прогон" с "сейчас". Если предыдущий
// прогон был больше EXPECTED_GAP_MINUTES назад, это симптом ровно той
// ситуации: сработал только часовой fallback, а 15-минутные dispatch'и от
// cron-job.org куда-то делись.
//
// Алерт шлётся не чаще раза в час естественным образом — сам факт, что
// следующий прогон случится только через час (fallback), не даёт спамить
// чаще, пока проблема не решена.

import { createClient } from "@supabase/supabase-js";
import { sendTelegram } from "./alerts.mjs";
import { logError } from "./log-error.js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// 15 минут — ожидаемый интервал от cron-job.org. Даём запас х2.5 (37 минут)
// прежде чем считать это тревогой — GitHub Actions иногда задерживает старт
// на несколько минут в пиковые часы, это не повод алертить на пустом месте.
const EXPECTED_GAP_MINUTES = 37;

/**
 * Сверяет время предыдущего heartbeat-а с текущим моментом и шлёт алерт
 * владельцу в Telegram, если разрыв подозрительно большой. Не бросает
 * исключений — сбой самой проверки не должен ронять синк.
 */
async function checkAndAlertIfLate(jobName) {
  try {
    const { data: previous } = await admin
      .from("cron_heartbeat")
      .select("last_run_at")
      .eq("job_name", jobName)
      .maybeSingle();

    if (previous?.last_run_at) {
      const gapMinutes = (Date.now() - new Date(previous.last_run_at).getTime()) / 60000;
      if (gapMinutes > EXPECTED_GAP_MINUTES) {
        const ownerChatId = process.env.OWNER_TELEGRAM_CHAT_ID;
        const text =
          `⚠️ RIVANT cron: прогон "${jobName}" не запускался ${Math.round(gapMinutes)} хв ` +
          `(очікувалось ~15 хв). Схоже, cron-job.org мовчить і зараз працює лише ` +
          `годинний GitHub fallback. Перевір https://cron-job.org.`;
        if (ownerChatId) {
          await sendTelegram(ownerChatId, text);
        } else {
          // OWNER_TELEGRAM_CHAT_ID ещё не настроен — не молчим совсем,
          // хотя бы попадаем в error_logs, чтобы не потерять сигнал.
          await logError({ source: "cron_heartbeat", message: text });
        }
      }
    }
  } catch (err) {
    // Проверка здоровья крона не должна ронять сам крон.
    console.error("[cron_heartbeat] check failed:", err);
  }
}

/**
 * Записывает факт завершения прогона — вызывается В КОНЦЕ run-sync.mjs,
 * независимо от того, были ли частичные сбои отдельных синков (hadFailure
 * относится к провайдерам, а не к самому факту "крон вообще прожил").
 */
async function recordHeartbeat(jobName, status, message) {
  try {
    await admin.from("cron_heartbeat").upsert(
      { job_name: jobName, last_run_at: new Date().toISOString(), status, message: message || null },
      { onConflict: "job_name" }
    );
  } catch (err) {
    console.error("[cron_heartbeat] record failed:", err);
  }
}

export { checkAndAlertIfLate, recordHeartbeat };
