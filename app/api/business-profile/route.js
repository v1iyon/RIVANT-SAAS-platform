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

  let { data: business } = await admin
    .from("businesses")
    .select("id, name, timezone")
    .eq("user_id", appUser.id)
    .limit(1)
    .maybeSingle();

  // Если бизнеса ещё нет — создаём пустой, чтобы было что редактировать
  if (!business) {
    const { data: created } = await admin
      .from("businesses")
      .insert({ user_id: appUser.id, name: "My Business", timezone: "America/New_York" })
      .select("id, name, timezone")
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