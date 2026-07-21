import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function POST(req) {
  const { email } = await req.json();
  if (!email) {
    return Response.json({ error: "email required" }, { status: 400 });
  }

  let { data: appUser } = await admin
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (!appUser) {
    const { data: created, error } = await admin
      .from("users")
      .insert({ email })
      .select("id")
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    appUser = created;
  }

  const token = crypto.randomUUID();
  const { error: tokenError } = await admin
    .from("link_tokens")
    .insert({ token, user_id: appUser.id });
  if (tokenError) return Response.json({ error: tokenError.message }, { status: 500 });

  return Response.json({ url: `https://t.me/rivant_os_bot?start=${token}` });
}