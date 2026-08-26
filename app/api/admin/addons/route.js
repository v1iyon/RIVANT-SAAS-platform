import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function GET(req) {
  const authError = requireAdmin(req);
  if (authError) return authError;

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
