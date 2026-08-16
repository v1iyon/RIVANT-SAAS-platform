import { createClient } from "@supabase/supabase-js";
import { requireUser, UnauthorizedError } from "@/lib/require-user";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// GET /api/profile -> отдаёт сохранённые full_name, phone, avatar_url, language
// текущего залогиненного пользователя.
//
// email больше не берём из query — это была ровно та же дыра п. 1.1, что и
// везде: любой, зная (или подобрав) чужой email, мог через
// GET /api/profile?email=жертва@x.com прочитать чужие full_name/phone/
// avatar_url/language без какого-либо входа в аккаунт.
//
// language теперь тоже отдаём отсюда: раньше язык интерфейса жил ТОЛЬКО в
// localStorage конкретного браузера (lib/translations.tsx), поэтому на новом
// устройстве (например, телефоне) он всегда стартовал с дефолта "EN", даже
// если на ноуте пользователь давно переключился на UA — привязки к аккаунту
// не было вообще. users.language используется ботом/алертами уже давно
// (см. sync-stripe-core.mjs), просто дашборд его никогда не читал обратно.
export async function GET(req) {
  let email;
  try {
    ({ email } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }

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

// POST /api/profile -> сохраняет full_name/phone/avatar_url/language для
// текущего залогиненного пользователя.
//
// email больше не берём из body — та же дыра п. 1.1: любой, зная чужой
// email, мог через POST /api/profile переписать чужие phone/avatar_url и
// остальные поля профиля без входа в аккаунт.
//
// ВАЖНО: .update() передаёт в БД только те поля, которые реально пришли в
// body — раньше передавались все 4 поля всегда, и вызывающая сторона могла
// отправить только { language } (как делает переключатель языка в
// настройках), а full_name/phone/avatar_url при этом улетали как undefined
// -> Supabase писал в них NULL, затирая уже сохранённые значения.
export async function POST(req) {
  let email;
  try {
    ({ email } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }

  const body = await req.json();
  const { full_name, phone, avatar_url, language } = body || {};

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