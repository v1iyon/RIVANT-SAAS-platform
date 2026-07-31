// app/api/alerts/route.ts
//
// Exposes alerts_log (written by scripts/sync-stripe-core.mjs when revenue
// drops >20%) to the dashboard's Risks tab. Until now nothing read this
// table from the frontend — the Risks tab showed a static demo array.
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function getBusinessId(email: string) {
  const { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!appUser) return null;
  const { data: business } = await admin
    .from("businesses")
    .select("id")
    .eq("user_id", appUser.id)
    .maybeSingle();
  return business?.id ?? null;
}

export async function GET(req: Request) {
  const email = new URL(req.url).searchParams.get("email");
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const businessId = await getBusinessId(email);
  if (!businessId) return Response.json({ alerts: [] });

  const { data: alerts, error } = await admin
    .from("alerts_log")
    .select("id, type, message, ai_explanation, status, severity, sent_at")
    .eq("business_id", businessId)
    .eq("status", "open")
    .order("sent_at", { ascending: false })
    .limit(30);

  if (error) {
    console.error("GET /api/alerts error:", error);
    return Response.json({ alerts: [] });
  }

  return Response.json({ alerts: alerts || [] });
}

// Marks one alert (or all open alerts) as resolved. Called when the user
// dismisses a risk card or clicks "Clear all" in the Risks tab.
export async function PATCH(req: Request) {
  try {
    const { email, id, resolveAll } = await req.json();
    if (!email) return Response.json({ error: "email required" }, { status: 400 });

    const businessId = await getBusinessId(email);
    if (!businessId) return Response.json({ error: "Business not found" }, { status: 404 });

    let query = admin
      .from("alerts_log")
      .update({ status: "resolved" })
      .eq("business_id", businessId)
      .eq("status", "open");

    if (!resolveAll) {
      if (!id) return Response.json({ error: "id or resolveAll required" }, { status: 400 });
      query = query.eq("id", id);
    }

    const { error } = await query;
    if (error) {
      console.error("PATCH /api/alerts error:", error);
      return Response.json({ error: "Server error" }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error("PATCH /api/alerts error:", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}