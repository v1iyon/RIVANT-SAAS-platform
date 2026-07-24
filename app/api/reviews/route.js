import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// GET — публичный список одобренных отзывов (для главной страницы)
export async function GET() {
  const { data: reviews } = await admin
    .from("reviews")
    .select("author_name, business_name, rating, comment, created_at")
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(9);

  return Response.json({ reviews: reviews || [] });
}

// POST — отправка нового отзыва (только зарегистрированные клиенты)
export async function POST(req) {
  const { email, author_name, business_name, rating, comment } = await req.json();
  if (!email || !author_name || !rating || !comment) {
    return Response.json({ error: "missing fields" }, { status: 400 });
  }
  if (rating < 1 || rating > 5) {
    return Response.json({ error: "invalid rating" }, { status: 400 });
  }

  const { data: user } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!user) return Response.json({ error: "user not found" }, { status: 404 });

  const { error } = await admin.from("reviews").insert({
    user_id: user.id,
    author_name,
    business_name: business_name || null,
    rating,
    comment,
    status: "pending",
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}