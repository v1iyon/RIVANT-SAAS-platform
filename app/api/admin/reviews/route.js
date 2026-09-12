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
    .select("*, users(avatar_url)")
    .order("created_at", { ascending: false });

  // Показываем модератору то же фото профиля, что увидят посетители сайта —
  // просто чтобы было видно, есть ли оно у автора, без отдельного поля ввода.
  const withAvatar = (reviews || []).map((r) => ({ ...r, avatar_url: r.users?.avatar_url || null }));

  return Response.json({ reviews: withAvatar });
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
