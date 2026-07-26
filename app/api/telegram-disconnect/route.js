import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function POST(req) {
  const { email } = await req.json();
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const { error } = await admin.from("users").update({ telegram_id: null }).eq("email", email);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}