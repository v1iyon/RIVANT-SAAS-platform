import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// GET /api/profile?email=... -> отдаёт сохранённые full_name, phone, avatar_url, language
//
// language теперь тоже отдаём отсюда: раньше язык интерфейса жил ТОЛЬКО в
// localStorage конкретного браузера (lib/translations.tsx), поэтому на новом
// устройстве (например, телефоне) он всегда стартовал с дефолта "EN", даже
// если на ноуте пользователь давно переключился на UA — привязки к аккаунту
// не было вообще. users.language используется ботом/алертами уже давно
// (см. sync-stripe-core.mjs), просто дашборд его никогда не читал обратно.
export async function GET(req) {
  const email = new URL(req.url).searchParams.get("email");
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const { data: appUser } = await admin
    .from("users")
    .select("full_name, phone, avatar_url, language")
    .eq("email", email)
    .maybeSingle();

  if (!appUser) {
    return Response.json({ full_name: null, phone: null, avatar_url: null, language: null });
  }

  return Response.json(appUser, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

// POST /api/profile -> сохраняет full_name/phone/avatar_url/language для пользователя по email
//
// ВАЖНО: раньше .update() всегда передавал все 4 поля, включая те, что не
// пришли в body — вызывающая сторона могла отправить только { email, language }
// (как теперь делает переключатель языка в настройках), и full_name/phone/
// avatar_url при этом улетали как undefined -> Supabase писал в них NULL,
// затирая уже сохранённые значения. Теперь обновляем в БД только те поля,
// которые реально присутствуют в теле запроса.
export async function POST(req) {
  const body = await req.json();
  const { email, full_name, phone, avatar_url, language } = body || {};

  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const updates = {};
  if (full_name !== undefined) updates.full_name = full_name;
  if (phone !== undefined) updates.phone = phone;
  if (avatar_url !== undefined) updates.avatar_url = avatar_url;
  if (language !== undefined) updates.language = language;

  if (Object.keys(updates).length === 0) {
    return Response.json({ ok: true }); // нечего обновлять
  }

  const { error } = await admin.from("users").update(updates).eq("email", email);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}