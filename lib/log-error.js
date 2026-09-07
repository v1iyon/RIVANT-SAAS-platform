const { createClient } = require("@supabase/supabase-js");

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Раніше помилки з платіжних вебхуків (Stripe/Ko-fi/крипто) лягали ТІЛЬКИ в
// error_logs — власник дізнавався про них, лише коли сам відкривав /admin.
// Якщо вебхук не активував підписку клієнту вночі, це могло висіти годинами
// непоміченим. BOT_TOKEN і Telegram-канал сповіщень вже є (src/bot.js) —
// перевикористовуємо той самий токен для алерту собі, окремого сервісу не
// підключаємо.
//
// ADMIN_TELEGRAM_CHAT_ID — chat_id власника/каналу для алертів (не плутати
// з chat_id клієнтів, куди бот шле їхні власні сповіщення). Якщо змінна не
// задана — просто пропускаємо надсилання, лог у БД все одно пишеться.
async function notifyOwnerTelegram(text) {
  const token = process.env.BOT_TOKEN;
  const chatId = process.env.ADMIN_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch (e) {
    // Алерт — це best-effort повідомлення, а не критична частина потоку:
    // якщо Telegram недоступний, помилка все одно вже записана в БД вище.
    console.error("Failed to send owner Telegram alert:", e.message);
  }
}

// severity — необов'язковий параметр (за замовчуванням не алертить).
// Викликач явно передає severity: "critical" тільки в дійсно грошових
// шляхах (платіжні вебхуки, збій синку джерела виручки) — щоб алерти в
// Telegram не перетворились на шум від кожної дрібної помилки синку.
async function logError({ source, message, details, businessId, severity }) {
  try {
    await admin.from("error_logs").insert({
      source,
      message,
      details: details || null,
      business_id: businessId || null,
    });
  } catch (e) {
    console.error("Failed to write error_logs:", e.message);
  }

  if (severity === "critical") {
    const detailsText =
      typeof details === "string" ? details : details ? JSON.stringify(details).slice(0, 500) : "";
    await notifyOwnerTelegram(
      `🔴 <b>RIVANT critical error</b>\nSource: ${source}\n${message}${detailsText ? `\n\n${detailsText}` : ""}${
        businessId ? `\nbusiness_id: ${businessId}` : ""
      }`
    );
  }
}

module.exports = { logError };