// lib/crypto.js
// Общий хелпер шифрования API-ключей интеграций (Stripe, Meta Ads, Google Ads, Shopify, Plaid...).
// Вынесено из app/api/connect-stripe/route.js и scripts/sync-stripe-core.mjs, чтобы не дублировать
// в каждом новом provider-модуле (Этап 3 плана).

const crypto = require("crypto");

function getKey() {
  return crypto.createHash("sha256").update(process.env.ENCRYPTION_KEY || "").digest();
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