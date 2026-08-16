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
    .from("feedback")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ feedback: data || [] });
}

export async function PUT(req) {
  if (!checkAuth(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id, status } = await req.json();
  if (!id || !status) return Response.json({ error: "id and status required" }, { status: 400 });

  const { error } = await admin.from("feedback").update({ status }).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true });
}