// lib/admin-auth.js
//
// Единая проверка входа в админку для всех /api/admin/* роутов + защита от
// подбора ADMIN_SECRET перебором (п. A7 аудита — isValidSecret уже
// timing-safe, но без лимита на число попыток).
//
// Считаем только НЕУДАЧНЫЕ попытки. Успешные запросы уже залогиненного
// админа (дашборд дёргает по 8-10 admin-эндпоинтов за одну загрузку
// страницы) в лимит не идут — иначе обычная работа сама себя блокировала бы.
import { isValidSecret } from "@/lib/verify-secret";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const MAX_FAILED_ATTEMPTS = 8;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 минут

// Возвращает null, если запрос авторизован — роут продолжает работу как
// раньше. Иначе — готовый Response, который роут должен вернуть как есть:
// 401 — неверный секрет, 429 — слишком много неудачных попыток с этого IP.
export function requireAdmin(req) {
  const secret = req.headers.get("x-admin-secret");

  if (isValidSecret(secret, process.env.ADMIN_SECRET)) {
    return null;
  }

  const ip = getClientIp(req);
  const { allowed, retryAfterSeconds } = checkRateLimit(`admin-auth-fail:${ip}`, {
    limit: MAX_FAILED_ATTEMPTS,
    windowMs: LOCKOUT_WINDOW_MS,
  });

  if (!allowed) {
    console.error(`admin auth: IP ${ip} locked out after ${MAX_FAILED_ATTEMPTS} failed attempts`);
    return Response.json(
      { error: "Too many attempts — try again later" },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
    );
  }

  console.error(`admin auth: failed attempt from IP ${ip}`);
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
