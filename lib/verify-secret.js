// lib/verify-secret.js
//
// Безопасное сравнение секрета из запроса (ADMIN_SECRET/CRON_SECRET) с
// ожидаемым значением. Обычное === сравнивает строки посимвольно и
// выходит на первом несовпадении — теоретически по времени ответа можно
// понять, сколько первых символов подобраны верно, и постепенно подобрать
// весь секрет (timing-атака). Панель доступна только вам, поэтому риск не
// первоочередной, но раз чинить — чинить правильно. См. п. 2.5 аудита.

import crypto from "crypto";

export function isValidSecret(provided, expected) {
  if (typeof provided !== "string" || !provided) return false;
  if (typeof expected !== "string" || !expected) return false;

  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);

  if (providedBuf.length !== expectedBuf.length) {
    // timingSafeEqual требует буферы одинаковой длины и иначе бросает
    // исключение. Просто возвращать false здесь раньше времени — тоже
    // маленькая временная утечка (длина неверного секрета отличается от
    // ожидаемой быстрее/медленнее). Сравниваем expected сам с собой, чтобы
    // время ответа было тем же, что и в "нормальном" случае.
    crypto.timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }

  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}