import { createClient } from "@supabase/supabase-js";
import { getClientIp, checkRateLimit, isHoneypotTripped } from "@/lib/rate-limit";
import { requireUser, UnauthorizedError } from "@/lib/require-user";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// GET — публичный список одобренных отзывов (для главной страницы).
// Не трогаем rate-limit'ом: это просто чтение публичных данных, лимит
// нужен только там, где запрос что-то создаёт/пишет.
export async function GET() {
  const { data: reviews } = await admin
    .from("reviews")
    .select("author_name, business_name, rating, comment, created_at, avatar_url")
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(9);

  return Response.json({ reviews: reviews || [] });
}

// 3 отзыва в час с одного IP — эта форма и так только для зарегистрированных
// клиентов (ищем user по email), но лимит всё равно нужен: без него можно
// было бы залить ленту отзывов десятками фейковых записей со статусом
// "pending" за секунды. Одобрение всё ещё модерируется вручную (status),
// но и в очередь на модерацию заваливать не стоит. См. п. 2.3 аудита.
const RATE_LIMIT = { limit: 3, windowMs: 60 * 60 * 1000 };

// POST — отправка нового отзыва (только зарегистрированные клиенты)
//
// ФІКС (п. B4 аудиту): раніше email бралось прямо з тіла запиту — будь-хто,
// не заходячи в акаунт, міг надіслати відгук "від імені" будь-якого реального
// клієнта, просто знаючи його email. Тепер особу автора беремо ТІЛЬКИ з
// поточної сесії (requireUser()), той самий патерн, що вже використаний в
// /api/metrics, /api/export-data і т.д. email з тіла запиту більше не
// приймається і ні на що не впливає.
export async function POST(req) {
  const ip = getClientIp(req);
  const { allowed, retryAfterSeconds } = checkRateLimit(`reviews:${ip}`, RATE_LIMIT);
  if (!allowed) {
    return Response.json(
      { error: "too many requests" },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
    );
  }

  let email;
  try {
    ({ email } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }

  const body = await req.json();
  const { author_name, business_name, rating, comment, avatar_url } = body;

  // Honeypot — см. lib/rate-limit.js. Фронту нужно добавить скрытое поле
  // с тем же именем в форму отзыва.
  if (isHoneypotTripped(body)) {
    return Response.json({ ok: true });
  }

  if (!author_name || !rating || !comment) {
    return Response.json({ error: "missing fields" }, { status: 400 });
  }
  if (rating < 1 || rating > 5) {
    return Response.json({ error: "invalid rating" }, { status: 400 });
  }

  // avatar_url необязателен: автор может прислать ссылку на своё реальное
  // фото (например, LinkedIn/Gravatar). Валидируем по минимуму — только
  // https-ссылка разумной длины, никакого upload'а файлов тут нет. Модератор
  // всё равно видит это поле в app/admin/reviews перед одобрением и может
  // очистить его, если ссылка выглядит подозрительно.
  let cleanAvatarUrl = null;
  if (avatar_url) {
    const trimmed = String(avatar_url).trim();
    if (trimmed.length > 500 || !/^https:\/\//i.test(trimmed)) {
      return Response.json({ error: "invalid avatar_url" }, { status: 400 });
    }
    cleanAvatarUrl = trimmed;
  }

  const { data: user } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!user) return Response.json({ error: "user not found" }, { status: 404 });

  const { error } = await admin.from("reviews").insert({
    user_id: user.id,
    author_name,
    business_name: business_name || null,
    rating,
    comment,
    avatar_url: cleanAvatarUrl,
    status: "pending",
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}