import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function GET(req) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  const { data: errors, error } = await admin
    .from("error_logs")
    .select("id, source, message, details, business_id, resolved, created_at")
    .eq("resolved", false)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ errors: errors || [] });
}

export async function PUT(req) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  const { id, resolved } = await req.json();
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  // Решённую ошибку сразу удаляем, чтобы не копилась — история решённых не нужна.
  if (resolved) {
    const { error } = await admin.from("error_logs").delete().eq("id", id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ success: true, deleted: true });
  }

  const { error } = await admin.from("error_logs").update({ resolved }).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true });
}

export async function DELETE(req) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const { error } = await admin.from("error_logs").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true });
}
