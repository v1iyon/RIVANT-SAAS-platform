import { createClient } from "@supabase/supabase-js";

// Важно: без этого Next.js может закэшировать ответ GET-роута,
// и изменения в базе (blocked/starter) не будут видны сразу.
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

  const { data: sub } = await admin
    .from("subscriptions")
    .select("plan, access_status, current_period_end")
    .eq("user_id", appUser.id)
    .maybeSingle();

  if (!sub) return Response.json({ plan: null, access_status: "none" });

  const periodEnded = sub.current_period_end
    ? new Date(sub.current_period_end) < new Date()
    : false;

  // Период (триал или оплаченный месяц) закончился -> блокируем доступ полностью.
  // Неважно plan="trial" или plan="growth" — если current_period_end
  // в прошлом и оплата не продлила период, доступ закрыт.
  // Когда подключим Paddle, вебхук на успешную оплату будет обновлять
  // current_period_end на новую дату и access_status обратно на "active".
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