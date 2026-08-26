import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function GET(req) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  const { data: leads } = await admin
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false });

  return Response.json({ leads: leads || [] });
}

export async function PUT(req) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  const { id, status } = await req.json();
  if (!id || !["contacted", "rejected"].includes(status)) {
    return Response.json({ error: "invalid input" }, { status: 400 });
  }

  const { error } = await admin.from("leads").update({ status }).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
