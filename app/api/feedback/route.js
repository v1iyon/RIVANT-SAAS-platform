import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function POST(req) {
  const { email, type, message } = await req.json();

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