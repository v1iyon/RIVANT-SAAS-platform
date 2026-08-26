import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function GET(req) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  const { data, error } = await admin
    .from("feedback")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ feedback: data || [] });
}

export async function PUT(req) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  const { id, status } = await req.json();
  if (!id || !status) return Response.json({ error: "id and status required" }, { status: 400 });

  const { error } = await admin.from("feedback").update({ status }).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true });
}
