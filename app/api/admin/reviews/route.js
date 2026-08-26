import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function GET(req) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  const { data: reviews } = await admin
    .from("reviews")
    .select("*")
    .order("created_at", { ascending: false });

  return Response.json({ reviews: reviews || [] });
}

export async function PUT(req) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  const { id, status } = await req.json();
  if (!id || !["approved", "rejected"].includes(status)) {
    return Response.json({ error: "invalid input" }, { status: 400 });
  }

  const { error } = await admin.from("reviews").update({ status }).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}

export async function DELETE(req) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  const { id } = await req.json();
  if (!id) return Response.json({ error: "invalid input" }, { status: 400 });

  const { error } = await admin.from("reviews").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
