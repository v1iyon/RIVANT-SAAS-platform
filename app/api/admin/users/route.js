import { createClient } from "@supabase/supabase-js";
import { isValidSecret } from "@/lib/verify-secret";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function checkAuth(req) {
  const secret = req.headers.get("x-admin-secret");
  return isValidSecret(secret, process.env.ADMIN_SECRET);
}

const VALID_PLANS = ["trial", "starter", "growth", "scale"];

export async function GET(req) {
  if (!checkAuth(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { data: users, error } = await admin
    .from("users")
    .select(
      `
      id,
      email,
      full_name,
      phone,
      telegram_id,
      language,
      is_blocked,
      created_at,
      subscriptions ( plan, access_status, current_period_end ),
      businesses ( id, name, integrations ( provider, status ) )
    `
    )
    .order("created_at", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ users: users || [] });
}

export async function PUT(req) {
  if (!checkAuth(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const { userId } = body;
  if (!userId) return Response.json({ error: "invalid input" }, { status: 400 });

  // Блокировка / разблокировка
  if (typeof body.is_blocked === "boolean") {
    const { error } = await admin
      .from("users")
      .update({ is_blocked: body.is_blocked })
      .eq("id", userId);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }

  // Смена тарифа
  if (body.plan) {
    if (!VALID_PLANS.includes(body.plan)) {
      return Response.json({ error: "invalid plan" }, { status: 400 });
    }
    const { error } = await admin
      .from("subscriptions")
      .update({ plan: body.plan })
      .eq("user_id", userId);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "no valid fields to update" }, { status: 400 });
}