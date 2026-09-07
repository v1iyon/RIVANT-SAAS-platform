// lib/mfa-backup-codes.js
//
// Генерація і хешування одноразових backup-кодів для 2FA (див.
// supabase/migrations/20260906000000_mfa_backup_codes.sql). Той самий
// принцип, що і lib/crypto.js: секрет ніколи не зберігається у відкритому
// вигляді, падаємо одразу, якщо ENCRYPTION_KEY не виставлено, а не тихо
// хешуємо чимось передбачуваним.
//
// HMAC-SHA256 із серверним секретом (не bcrypt/scrypt) — свідомий вибір:
// це НЕ пароль користувача (низька ентропія, брутфорс-загроза), а
// 10-символьний випадковий код з ентропією ~51 біт (36^10), який до того ж
// одноразовий і видаляється/позначається used_at одразу після
// використання. Повільне хешування паролів тут не додає захисту, а лише
// сповільнює перевірку без реальної користі.
const crypto = require("crypto");

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // без 0/O/1/I — важко переплутати при переписуванні вручну
const CODE_LENGTH = 10;
const CODES_PER_BATCH = 10;

function getSecret() {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "ENCRYPTION_KEY is not set — refusing to hash backup codes with a fallback key. " +
        "Set ENCRYPTION_KEY in the environment before using lib/mfa-backup-codes.js."
    );
  }
  return secret;
}

function hashBackupCode(code) {
  const normalized = String(code || "").trim().toUpperCase().replace(/[\s-]/g, "");
  return crypto.createHmac("sha256", getSecret()).update(normalized).digest("hex");
}

function generateOneCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  // Формат XXXXX-XXXXX — тільки для читабельності при переписуванні/друку,
  // hashBackupCode() вище прибирає дефіс перед хешуванням, тож "ABCDE-FGHJK"
  // і "ABCDEFGHJK" хешуються однаково.
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

// Повертає { plainCodes: string[], hashes: string[] } — plainCodes
// показуються користувачу РІВНО ОДИН РАЗ одразу після генерації і ніде
// більше не зберігаються; у БД пишуться лише hashes.
function generateBackupCodes(count = CODES_PER_BATCH) {
  const plainCodes = Array.from({ length: count }, generateOneCode);
  const hashes = plainCodes.map(hashBackupCode);
  return { plainCodes, hashes };
}

module.exports = { generateBackupCodes, hashBackupCode, CODES_PER_BATCH };
