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

export async function GET(req) {
  if (!checkAuth(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { data: addons, error } = await admin
    .from("addon_subscriptions")
    .select(
      `
      id,
      addon_type,
      status,
      current_period_end,
      paddle_subscription_id,
      created_at,
      business_id,
      businesses ( id, name, users ( id, email, full_name ) )
    `
    )
    .order("created_at", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ addons: addons || [] });
}