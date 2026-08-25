// lib/business-date.ts
//
// Единый источник правды для "какой сейчас день у бизнеса" — по таймзоне
// самого бизнеса (businesses.timezone), а НЕ по UTC и НЕ по локальной
// таймзоне браузера/сервера, на котором выполняется код.
//
// См. п. 3 аудита: до этого один и тот же расчёт "сегодня"/"начало месяца"
// был продублирован (и слегка разошёлся) в src/bot.js, scripts/daily-reports.mjs
// и scripts/sync-stripe-core.mjs, а в app/dashboard/page.tsx график вообще
// использовал смесь UTC-даты (`toISOString()`) и локальной даты БРАУЗЕРА
// (`getFullYear()/getMonth()` без `UTC`-префикса) — то есть "сегодня" на
// графике в дашборде могло не совпадать ни с UTC, ни с локальным временем
// пользователя, ни (тем более) с датой, по которой реально агрегированы
// metrics_computed на бэкенде.
//
// Используем Intl.DateTimeFormat вместо ручных офсетов — он работает
// одинаково и в браузере (client component), и в Node (API routes, cron
// scripts), учитывает DST автоматически и не требует никаких доп. пакетов.
//
// FALLBACK_TZ синхронизирован с src/bot.js/scripts/daily-reports.mjs —
// используется только если businesses.timezone почему-то не задан или
// оказался невалидным для Intl.
export const FALLBACK_BUSINESS_TZ = "Europe/Kyiv";

// "Сегодня" по локальному календарю бизнеса, в формате YYYY-MM-DD.
// en-CA даёт готовый ISO-подобный YYYY-MM-DD без ручной сборки строки.
export function businessDateStr(tz?: string | null, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || FALLBACK_BUSINESS_TZ }).format(at);
  } catch {
    // Невалидное имя таймзоны (например, испорченные данные в БД) —
    // не роняем рендер/расчёт, откатываемся на fallback.
    return new Intl.DateTimeFormat("en-CA", { timeZone: FALLBACK_BUSINESS_TZ }).format(at);
  }
}

// Первое число текущего календарного месяца по таймзоне бизнеса, в формате
// YYYY-MM-DD. Раньше на дашборде это считалось через new Date().getFullYear()/
// getMonth() браузера — то есть "начало месяца" зависело от того, в каком
// часовом поясе физически находится устройство, с которого смотрят дашборд,
// а не от таймзоны самого бизнеса.
export function businessMonthStartStr(tz?: string | null, at: Date = new Date()): string {
  const todayStr = businessDateStr(tz, at);
  return `${todayStr.slice(0, 7)}-01`;
}