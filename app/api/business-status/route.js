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

  const { data: business } = await admin
    .from("businesses")
    .select("id, name")
    .eq("user_id", appUser.id)
    .limit(1)
    .maybeSingle();

  if (!business) return Response.json({ business: null });

  const { data: integration } = await admin
    .from("integrations")
    .select("status, last_synced_at")
    .eq("business_id", business.id)
    .eq("provider", "stripe")
    .maybeSingle();

  return Response.json({
    business: {
      ...business,
      stripe_connected: integration?.status === "connected",
      last_synced_at: integration?.last_synced_at || null,
    },
  });
}