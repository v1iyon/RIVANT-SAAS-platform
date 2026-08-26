// lib/require-active-subscription.ts
//
// Единая проверка "оплачена ли подписка ПРЯМО СЕЙЧАС" для роутов, отдающих
// платные данные (metrics, alerts, forecast, export). requireUser() проверял
// только "залогинен ли человек вообще" — не access_status и не срок
// действия. См. п. B1 аудита.
//
// Читает access_status и current_period_end НАПРЯМУЮ, а не полагается на
// то, что кто-то другой (например, поллинг /api/subscription-status с
// фронта) уже успел его актуализировать — иначе есть окно, где просроченная
// подписка ещё выглядит активной для роутов, которые её не перепроверяют
// сами. Задача этого хелпера — только БЛОКИРОВАТЬ доступ вовремя; сама
// очистка полей (сброс plan, отключение интеграций при истечении триала)
// остаётся за /api/subscription-status, как и было — дублировать эти
// побочные эффекты здесь не нужно.
import { createClient } from "@supabase/supabase-js";
import { requireUser, UnauthorizedError } from "@/lib/require-user";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export { UnauthorizedError };

export class SubscriptionInactiveError extends Error {
  reason: string;
  constructor(reason: string) {
    super(`subscription_inactive: ${reason}`);
    this.name = "SubscriptionInactiveError";
    this.reason = reason;
  }
}

export type ActiveSubscription = {
  userId: string;
  email: string;
  plan: string | null;
  accessStatus: string;
};

export async function requireActiveSubscription(): Promise<ActiveSubscription> {
  // Бросит UnauthorizedError, если человек вообще не залогинен — это
  // отдельная, более базовая проверка, её поведение не меняем.
  const { email } = await requireUser();

  const { data: appUser } = await admin
    .from("users")
    .select("id, is_blocked")
    .eq("email", email)
    .maybeSingle();

  if (!appUser) throw new SubscriptionInactiveError("no_account");
  if (appUser.is_blocked) throw new SubscriptionInactiveError("blocked");

  let { data: sub } = await admin
    .from("subscriptions")
    .select("plan, access_status, current_period_end")
    .eq("user_id", appUser.id)
    .maybeSingle();

  // Тот же лениво-создающийся триал, что и в subscription-status/route.js —
  // если это первый запрос платного роута ДО того, как фронт вообще
  // опросил /api/subscription-status (например, прямой curl сразу после
  // регистрации), у пользователя ещё может не быть строки в subscriptions.
  if (!sub) {
    const periodEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: created } = await admin
      .from("subscriptions")
      .insert({
        user_id: appUser.id,
        plan: "trial",
        access_status: "trial",
        current_period_end: periodEnd,
      })
      .select("plan, access_status, current_period_end")
      .maybeSingle();
        sub = created ?? null;
  }

  if (!sub) throw new SubscriptionInactiveError("no_subscription");
  if (sub.access_status === "blocked") throw new SubscriptionInactiveError("blocked");

  const periodEnded = sub.current_period_end
    ? new Date(sub.current_period_end) < new Date()
    : false;
  if (periodEnded) throw new SubscriptionInactiveError("expired");

  return { userId: appUser.id, email, plan: sub.plan, accessStatus: sub.access_status };
}

export function subscriptionErrorResponse(err: SubscriptionInactiveError) {
  // 402 Payment Required — отдельно от 401 (не залогинен), чтобы фронт мог
  // различить "покажи логин" от "покажи оплатить/продлить".
  return Response.json({ error: "subscription_required", reason: err.reason }, { status: 402 });
}