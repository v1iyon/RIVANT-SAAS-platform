import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function checkAuth(req) {
  const secret = req.headers.get("x-admin-secret");
  return secret === process.env.ADMIN_SECRET;
}

export async function GET(req) {
  if (!checkAuth(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { data: subscriptions, error } = await admin
    .from("subscriptions")
    .select(
      `
      id,
      plan,
      access_status,
      current_period_end,
      created_at,
      provider_subscription_id,
      paddle_subscription_id,
      users ( id, email, full_name )
    `
    )
    .order("created_at", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ subscriptions: subscriptions || [] });
}