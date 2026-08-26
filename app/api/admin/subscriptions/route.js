import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function GET(req) {
  const authError = requireAdmin(req);
  if (authError) return authError;

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
