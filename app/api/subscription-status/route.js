import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function GET(req) {
  const email = new URL(req.url).searchParams.get("email");
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!appUser) return Response.json({ plan: null, access_status: "none" });

  const { data: sub } = await admin
    .from("subscriptions")
    .select("plan, access_status, current_period_end")
    .eq("user_id", appUser.id)
    .maybeSingle();

  return Response.json(sub || { plan: null, access_status: "none" });
}s