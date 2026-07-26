import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function GET(req) {
  const email = new URL(req.url).searchParams.get("email");
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const { data: appUser } = await admin
    .from("users")
    .select("id, is_blocked")
    .eq("email", email)
    .maybeSingle();

  if (!appUser) return Response.json({ plan: null, access_status: "none", is_blocked: false });

  // Блокировка админом — проверяем в первую очередь, до всей логики подписки.
  // Не трогаем access_status в базе (подписка может быть активной и
  // восстановится сама, если админ разблокирует), просто явно сообщаем
  // фронтенду отдельным полем.
  if (appUser.is_blocked) {
    return Response.json(
      { plan: null, access_status: "blocked", is_blocked: true },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }

  let { data: sub } = await admin
    .from("subscriptions")
    .select("plan, access_status, current_period_end")
    .eq("user_id", appUser.id)
    .maybeSingle();

  if (!sub) {
    const periodEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: created, error } = await admin
      .from("subscriptions")
      .insert({
        user_id: appUser.id,
        plan: "trial",
        access_status: "trial",
        current_period_end: periodEnd,
      })
      .select("plan, access_status, current_period_end")
      .maybeSingle();

    if (error) {
      return Response.json(
        { plan: null, access_status: "blocked", is_blocked: false },
        { headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }
    sub = created;
  }

  const periodEnded = sub.current_period_end
    ? new Date(sub.current_period_end) < new Date()
    : false;

  if (periodEnded && sub.access_status !== "blocked") {
    await admin
      .from("subscriptions")
      .update({ access_status: "blocked" })
      .eq("user_id", appUser.id);

    return Response.json(
      { ...sub, access_status: "blocked", is_blocked: false },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }

  return Response.json(
    { ...sub, is_blocked: false },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}