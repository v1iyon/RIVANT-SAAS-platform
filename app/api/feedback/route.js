import { createClient } from "@supabase/supabase-js";
import { getClientIp, checkRateLimit, isHoneypotTripped } from "@/lib/rate-limit";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// 10 в час с одного IP — выше, чем у контактной формы, потому что это
// форма для уже зарегистрированных пользователей продукта (баг-репорты
// могут идти чаще одного за раз), но всё ещё далеко за пределами того, что
// сделает живой человек. См. п. 2.3 аудита.
const RATE_LIMIT = { limit: 10, windowMs: 60 * 60 * 1000 };

export async function POST(req) {
  const ip = getClientIp(req);
  const { allowed, retryAfterSeconds } = checkRateLimit(`feedback:${ip}`, RATE_LIMIT);
  if (!allowed) {
    return Response.json(
      { error: "too many requests" },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
    );
  }

  const body = await req.json();
  const { email, type, message } = body;

  // Honeypot — см. lib/rate-limit.js. Фронту нужно добавить скрытое поле
  // с тем же именем в форму фидбека.
  if (isHoneypotTripped(body)) {
    return Response.json({ success: true });
  }

  if (!email || !message || !message.trim()) {
    return Response.json({ error: "email and message required" }, { status: 400 });
  }

  const { data: user } = await admin.from("users").select("id").eq("email", email).maybeSingle();

  const { error } = await admin.from("feedback").insert({
    user_id: user?.id || null,
    email,
    type: type === "feature" ? "feature" : "bug",
    message: message.trim(),
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true });
}