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

  const { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!appUser) return Response.json({ plan: null, access_status: "none" });

  let { data: sub } = await admin
    .from("subscriptions")
    .select("plan, access_status, current_period_end")
    .eq("user_id", appUser.id)
    .maybeSingle();

  // Если у пользователя вообще нет записи в subscriptions (баг регистрации,
  // ручное создание аккаунта и т.п.) — самовосстанавливаемся: создаём
  // ему триал на 14 дней, а не оставляем "голым" без подписки.
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
      // Если создать не удалось — лучше явно заблокировать, чем молча
      // давать частичный доступ без какой-либо записи о подписке.
      return Response.json(
        { plan: null, access_status: "blocked" },
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
      { ...sub, access_status: "blocked" },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }

  return Response.json(sub, { headers: { "Cache-Control": "no-store, max-age=0" } });
}