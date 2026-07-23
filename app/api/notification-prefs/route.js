import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function GET(req) {
  const email = new URL(req.url).searchParams.get("email");
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const { data: user } = await admin
    .from("users")
    .select("push_enabled, email_enabled")
    .eq("email", email)
    .maybeSingle();

  return Response.json({
    push_enabled: user?.push_enabled ?? true,
    email_enabled: user?.email_enabled ?? true,
  });
}

export async function PUT(req) {
  const { email, push_enabled, email_enabled } = await req.json();
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const updates = {};
  if (push_enabled !== undefined) updates.push_enabled = push_enabled;
  if (email_enabled !== undefined) updates.email_enabled = email_enabled;

  const { error } = await admin.from("users").update(updates).eq("email", email);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}