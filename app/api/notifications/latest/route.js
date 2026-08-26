import { createClient } from "@supabase/supabase-js";
import { requireUser, UnauthorizedError } from "@/lib/require-user";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const LANGS = ["EN", "UA", "DE"];

export async function GET(req) {
  let email;
  try {
    ({ email } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }

  const { data: user } = await admin
    .from("users")
    .select("last_seen_broadcast_at, language")
    .eq("email", email)
    .maybeSingle();

  // п. B6 аудита: раньше отдавали одно общее поле message — тот текст,
  // на котором админ написал рассылку. Теперь берём три языковые колонки
  // и выбираем нужную по users.language самого посетителя (тот же фолбэк
  // на EN, что и в notifications/send/route.js, на случай если у юзера
  // language не выставлен или для этой рассылки текст на его языке пуст).
  const { data: latest } = await admin
    .from("broadcast_notifications")
    .select("id, message_en, message_ua, message_de, created_at, expires_at")
    .eq("sent_inapp", true)
    .or(`expires_at.is.null,expires_at.gte.${new Date().toISOString()}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latest) return Response.json({ notification: null });

  const alreadySeen =
    user?.last_seen_broadcast_at &&
    new Date(user.last_seen_broadcast_at) >= new Date(latest.created_at);

  if (alreadySeen) return Response.json({ notification: null });

  const lang = LANGS.includes(user?.language) ? user.language : "EN";
  const byLang = { EN: latest.message_en, UA: latest.message_ua, DE: latest.message_de };
  const message = byLang[lang] || latest.message_en;

  return Response.json({
    notification: { id: latest.id, message, created_at: latest.created_at, expires_at: latest.expires_at },
  });
}

export async function POST(req) {
  let email;
  try {
    ({ email } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }

  await admin
    .from("users")
    .update({ last_seen_broadcast_at: new Date().toISOString() })
    .eq("email", email);

  return Response.json({ success: true });
}