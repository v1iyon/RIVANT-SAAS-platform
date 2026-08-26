// lib/crypto.js
// Общий хелпер шифрования API-ключей интеграций (Stripe, Meta Ads, Google Ads, Shopify, Plaid...).
// Вынесено из app/api/connect-stripe/route.js и scripts/sync-stripe-core.mjs, чтобы не дублировать
// в каждом новом provider-модуле (Этап 3 плана).

const crypto = require("crypto");

// ФІКС (п. A8 аудиту): раніше при відсутньому ENCRYPTION_KEY код мовчки
// шифрував усе детермінованим ключем sha256("") замість того, щоб впасти
// з помилкою. Якщо змінна середовища з якоїсь причини не виставлена
// (одруківка в імені на новому деплої/оточенні, забули прописати в Vercel
// для preview-оточення тощо) — усі OAuth/API-токени інтеграцій (Stripe
// refresh_token, Google Ads client_secret/developer_token і т.д.)
// шифрувалися б ключем, відомим будь-кому, хто читав цей файл. Тепер —
// падаємо одразу при першому виклику, той самий принцип, що вже
// застосований для GOOGLE_ADS_CLIENT_ID/PADDLE_WEBHOOK_SECRET в інших
// місцях коду.
function getKey() {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "ENCRYPTION_KEY is not set — refusing to encrypt/decrypt with a fallback key. " +
        "Set ENCRYPTION_KEY in the environment before using lib/crypto.js."
    );
  }
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

function decrypt(payload) {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

module.exports = { encrypt, decrypt };