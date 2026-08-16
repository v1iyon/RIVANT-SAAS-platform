// lib/rate-limit.js
//
// Простая защита публичных форм (contact/feedback/reviews) от спама и
// флуда без внешних сервисов — не требует ключей/аккаунта, работает сразу.
// См. п. 2.3 аудита.
//
// ВАЖНО про serverless: это in-memory лимит внутри ОДНОГО инстанса функции
// Vercel. Под реальной нагрузкой Vercel поднимает несколько параллельных
// инстансов, и у каждого — свой счётчик, поэтому фактический лимит может
// быть кратно больше заданного (например, лимит 5/час может на практике
// пропустить 15-20 запросов, если поднялось несколько инстансов). Для
// сайта, который ещё не индексируется и не имеет трафика, этого достаточно,
// чтобы отсечь примитивных ботов-скриптеров. Если трафик вырастет и это
// станет проблемой — нужно перейти на общий стор между инстансами
// (например, Upstash Redis, у которого есть бесплатный тариф и готовый
// rate-limit пакет @upstash/ratelimit).

const buckets = new Map();

// Периодическая чистка старых записей, чтобы Map не рос бесконечно на
// долгоживущем инстансе — без этого он держал бы запись на каждый
// когда-либо постучавшийся IP до перезапуска функции.
const CLEANUP_THRESHOLD = 5000;
function cleanupIfNeeded() {
  if (buckets.size < CLEANUP_THRESHOLD) return;
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
}

export function getClientIp(req) {
  // На Vercel x-forwarded-for содержит реальный IP клиента первым в списке
  // (остальные — прокси на пути). x-real-ip — запасной вариант.
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

// key — обычно `${routeName}:${ip}`, чтобы лимиты разных форм не мешали
// друг другу и один и тот же IP не спамил один эндпоинт больше нормы.
export function checkRateLimit(key, { limit, windowMs }) {
  cleanupIfNeeded();

  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (bucket.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return { allowed: true };
}

// Honeypot: скрытое от людей стилями (display:none / visually-hidden), но
// видимое ботам поле формы. Настоящий пользователь никогда его не
// заполнит — если оно не пустое, запрос почти наверняка от бота.
//
// Роут в этом случае должен вернуть обычный 200 { ok: true } (см. вызовы
// ниже) — НЕ 400/403 и без пояснений, чтобы не подсказывать боту, что его
// вычислили и по какому полю. Имя поля намеренно не в стиле "honeypot"
// или "bot-field" — как раз такие имена автозаполнители спам-ботов уже
// умеют пропускать.
export function isHoneypotTripped(body, honeypotField = "website_url") {
  const value = body?.[honeypotField];
  return typeof value === "string" && value.trim() !== "";
}