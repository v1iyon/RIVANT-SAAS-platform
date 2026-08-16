import { createClient } from "@supabase/supabase-js";
import { isValidSecret } from "@/lib/verify-secret";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function checkAuth(req) {
  return isValidSecret(req.headers.get("x-admin-secret"), process.env.ADMIN_SECRET);
}

export async function GET(req) {
  if (!checkAuth(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await admin
    .from("broadcast_notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ notifications: data || [] });
}