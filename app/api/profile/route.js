import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// GET /api/profile?email=... -> отдаёт сохранённые full_name, phone, avatar_url
export async function GET(req) {
  const email = new URL(req.url).searchParams.get("email");
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const { data: appUser } = await admin
    .from("users")
    .select("full_name, phone, avatar_url")
    .eq("email", email)
    .maybeSingle();

  if (!appUser) return Response.json({ full_name: null, phone: null, avatar_url: null });

  return Response.json(appUser, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

// POST /api/profile -> сохраняет full_name/phone/avatar_url для пользователя по email
export async function POST(req) {
  const body = await req.json();
  const { email, full_name, phone, avatar_url } = body || {};

  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const { error } = await admin
    .from("users")
    .update({ full_name, phone, avatar_url })
    .eq("email", email);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}