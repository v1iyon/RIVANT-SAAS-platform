// app/api/alerts/route.ts
import { createClient } from "@supabase/supabase-js";
import { getPrimaryBusinessId } from "@/lib/get-primary-business";
import { requireUser, UnauthorizedError } from "@/lib/require-user";
import {
  requireActiveSubscription,
  SubscriptionInactiveError,
  subscriptionErrorResponse,
} from "@/lib/require-active-subscription";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function getBusinessId(userId: string) {
  return getPrimaryBusinessId(admin, userId);
}

export async function GET(req: Request) {
  // п. B1 аудита: раньше /api/alerts вообще не смотрел ни на plan, ни на
  // access_status — отдавал alerts_log любому залогиненному владельцу
  // бизнеса, даже заблокированному/просроченному.
  let userId: string;
  try {
    ({ userId } = await requireActiveSubscription());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (e instanceof SubscriptionInactiveError) return subscriptionErrorResponse(e);
    throw e;
  }

  const businessId = await getBusinessId(userId);
  if (!businessId) return Response.json({ alerts: [] });

  const { data: openAlerts, error: openError } = await admin
    .from("alerts_log")
    .select("id, type, message, ai_explanation, status, severity, sent_at")
    .eq("business_id", businessId)
    .eq("status", "open")
    .not("type", "in", "(daily_digest_morning,daily_digest_evening)")
    .order("sent_at", { ascending: false })
    .limit(30);

  const { data: resolvedAlerts, error: resolvedError } = await admin
    .from("alerts_log")
    .select("id, type, message, ai_explanation, status, severity, sent_at")
    .eq("business_id", businessId)
    .eq("status", "resolved")
    .not("type", "in", "(daily_digest_morning,daily_digest_evening)")
    .order("sent_at", { ascending: false })
    .limit(30);

  if (openError || resolvedError) {
    console.error("GET /api/alerts error:", openError || resolvedError);
    return Response.json({ alerts: [], resolvedAlerts: [] });
  }

  return Response.json({ alerts: openAlerts || [], resolvedAlerts: resolvedAlerts || [] });
}

export async function PATCH(req: Request) {
  try {
    const { id, resolveAll } = await req.json();
    const { email } = await requireUser();

    const { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    if (!appUser) return Response.json({ error: "Business not found" }, { status: 404 });

    const businessId = await getBusinessId(appUser.id);
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
    if (err instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    console.error("PATCH /api/alerts error:", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { email } = await requireUser();

    const { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    if (!appUser) return Response.json({ error: "Business not found" }, { status: 404 });

    const businessId = await getBusinessId(appUser.id);
    if (!businessId) return Response.json({ error: "Business not found" }, { status: 404 });

    const { error } = await admin
      .from("alerts_log")
      .delete()
      .eq("business_id", businessId)
      .eq("status", "resolved");

    if (error) {
      console.error("DELETE /api/alerts error:", error);
      return Response.json({ error: "Server error" }, { status: 500 });
    }

    return Response.json({ success: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    console.error("DELETE /api/alerts error:", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}