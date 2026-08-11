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
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return business?.id ?? null;
}

export async function GET(req: Request) {
  const email = new URL(req.url).searchParams.get("email");
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const businessId = await getBusinessId(email);
  if (!businessId) return Response.json({ alerts: [] });

  const { data: openAlerts, error: openError } = await admin
    .from("alerts_log")
    .select("id, type, message, ai_explanation, status, severity, sent_at")
    .eq("business_id", businessId)
    .eq("status", "open")
    .not("type", "in", "(daily_digest_morning,daily_digest_evening)")
    .order("sent_at", { ascending: false })
    .limit(30);

  // Раніше resolved-алерти (система сама закриває їх, коли виручка
  // відновлюється — див. scripts/sync-stripe-core.mjs) взагалі не
  // потрапляли на фронт: /api/alerts фільтрував лише status="open", і
  // закрита проблема просто зникала з вкладки "Ризики" без сліду, хоча в
  // базі вона нікуди не ділась. Тепер віддаємо їх окремим полем — фронт
  // показує їх у вкладці "Історія", а не змішує з активними.
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

// Permanently clears resolved alerts (the "Історія" tab). PATCH above only
// flips status open->resolved, so it can't be reused to empty a tab that's
// already all-resolved — this actually deletes the rows the user asked to
// clear from their history.
export async function DELETE(req: Request) {
  try {
    const { email } = await req.json();
    if (!email) return Response.json({ error: "email required" }, { status: 400 });

    const businessId = await getBusinessId(email);
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
    console.error("DELETE /api/alerts error:", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
