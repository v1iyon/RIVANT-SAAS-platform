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
  if (!checkAuth(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

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
  if (!checkAuth(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const { error } = await admin.from("error_logs").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true });
}