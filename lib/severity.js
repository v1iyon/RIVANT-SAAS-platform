// lib/severity.js
//
// ЕДИНЫЙ источник текста важности алертов. Раньше сайт показывал жёсткое
// "HIGH"/"CRITICAL" на английском (risk.severity.toUpperCase()), а Telegram —
// локализованный лейбл с эмодзи ("Важливо"). Для одного и того же алерта
// пользователь видел два разных обозначения важности. Теперь и сайт, и бот,
// и sync-скрипты берут подпись отсюда — правим важность в одном месте.

export const SEVERITY_LABELS = {
  critical: { UA: "Критично", EN: "Critical", DE: "Kritisch" },
  high: { UA: "Важливо", EN: "High", DE: "Wichtig" },
  medium: { UA: "Середньо", EN: "Medium", DE: "Mittel" },
  low: { UA: "Низько", EN: "Low", DE: "Niedrig" },
};

// Кольорові кружечки — ТІЛЬКИ для Telegram/email (звичайний текст, іконку
// кольору там нічим більше не показати). У веб-кабінеті/деmo severity вже
// візуалізується кольоровим бейджем (getSeverityColorClasses), тож емодзі
// в SEVERITY_LABELS не дублюємо — інакше кружечок буде і в бейджі, і в тексті.
const SEVERITY_EMOJI = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
};

export function getSeverityLabel(severity, lang) {
  const entry = SEVERITY_LABELS[severity] || SEVERITY_LABELS.medium;
  return entry[lang] || entry.EN;
}

// Для Telegram/email-повідомлень — з кольоровим кружечком попереду.
export function getSeverityTelegramLabel(severity, lang) {
  const emoji = SEVERITY_EMOJI[severity] || SEVERITY_EMOJI.medium;
  return `${emoji} ${getSeverityLabel(severity, lang)}`;
}

// Цвета для бейджа/иконки на сайте — тоже общие, чтобы critical/high выглядели
// одинаково везде, где отрисовывается severity.
export function getSeverityColorClasses(severity) {
  if (severity === "high" || severity === "critical") {
    return { bg: "bg-red-500/20", text: "text-red-400" };
  }
  if (severity === "medium") {
    return { bg: "bg-yellow-500/20", text: "text-yellow-400" };
  }
  return { bg: "bg-blue-500/20", text: "text-blue-400" };
}