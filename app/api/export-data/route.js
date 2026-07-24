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
    .select("id, email, language, created_at")
    .eq("email", email)
    .maybeSingle();

  if (!user) return Response.json({ error: "user not found" }, { status: 404 });

  const { data: businesses } = await admin
    .from("businesses")
    .select("id, name, timezone, created_at")
    .eq("user_id", user.id);

  const businessIds = (businesses || []).map((b) => b.id);

  const { data: metrics } = businessIds.length
    ? await admin.from("metrics_computed").select("*").in("business_id", businessIds)
    : { data: [] };

  const { data: alerts } = businessIds.length
    ? await admin.from("alerts_log").select("*").in("business_id", businessIds)
    : { data: [] };

  const { data: subscription } = await admin
    .from("subscriptions")
    .select("plan, access_status, current_period_end, created_at")
    .eq("user_id", user.id)
    .maybeSingle();

  const exportPayload = {
    exported_at: new Date().toISOString(),
    account: user,
    subscription,
    businesses,
    metrics,
    alerts,
  };

  return new Response(JSON.stringify(exportPayload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="rivant-export-${Date.now()}.json"`,
    },
  });
}