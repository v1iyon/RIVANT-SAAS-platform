import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function POST(req) {
  const { email, language } = await req.json();
  if (!email) return Response.json({ error: "email required" }, { status: 400 });
  const lang = ["EN", "DE", "UA"].includes(language) ? language : "EN";

  let { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();

  if (!appUser) {
    const defaultName = email.split("@")[0];

    const { data: created, error } = await admin
      .from("users")
      .insert({ email, language: lang, full_name: defaultName })
      .select("id")
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    appUser = created;

    const trialEnd = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
    await admin.from("subscriptions").insert({
      user_id: appUser.id,
      plan: "trial",
      access_status: "trial",
      current_period_end: trialEnd,
    });
  }

  return Response.json({ ok: true });
}