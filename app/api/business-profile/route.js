import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function GET(req) {
  const email = new URL(req.url).searchParams.get("email");
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!appUser) return Response.json({ business: null });

  // Без ORDER BY .limit(1) не гарантує, яку саме строку поверне Postgres,
  // якщо у користувача чомусь опинилось БІЛЬШЕ ОДНІЄЇ строки в businesses
  // (наприклад, з гонки двох паралельних перших завантажень дашборду, які
  // одночасно побачили "бізнесу нема" і обидва встигли створити свій).
  // Раніше це виглядало як "назва компанії/ID то є, то раптом пропадає" —
  // насправді просто щоразу підтягувалась інша строка. created_at ASC
  // робить вибір детермінованим (завжди найперша створена).
  let { data: business } = await admin
    .from("businesses")
    .select("id, name, timezone, rolling_metrics")
    .eq("user_id", appUser.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  // Если бизнеса ещё нет — создаём пустой, чтобы было что редактировать
  if (!business) {
    const { data: created } = await admin
      .from("businesses")
      .insert({ user_id: appUser.id, name: "My Business" })
      .select("id, name, timezone, rolling_metrics")
      .single();
    business = created;
  }

  return Response.json({ business });
}

export async function PUT(req) {
  const { email, name, timezone } = await req.json();
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!appUser) return Response.json({ error: "user not found" }, { status: 404 });

  const { data: business } = await admin
    .from("businesses")
    .select("id")
    .eq("user_id", appUser.id)
    .limit(1)
    .maybeSingle();
  if (!business) return Response.json({ error: "business not found" }, { status: 404 });

  const updates = {};
  if (name !== undefined) updates.name = name;
  if (timezone !== undefined) updates.timezone = timezone;

  const { error } = await admin.from("businesses").update(updates).eq("id", business.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}