import { createClient } from "@supabase/supabase-js";
import { requireUser, UnauthorizedError } from "@/lib/require-user";
import { ensureTrial } from "@/lib/ensure-trial";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function GET(req) {
  let email;
  try {
    ({ email } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }

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
    // ФІКС (аудит #2, знахідка №14): раніше створення trial-підписки було
    // продубльоване тут окремим блоком — тепер спільна lib/ensure-trial.js,
    // та сама, що й у telegram-connect/route.js.
    const { sub: created, error } = await ensureTrial(appUser.id, email);

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

  if (periodEnded) {
    // Триал закончился -> мягкий сброс на "точку 0", а не блокировка.
    // Платный план (starter/growth/scale) закончился -> блокировка, как раньше.
    if (sub.plan === "trial") {
      // plan: null + access_status: "expired" — отдельное состояние, отличное
      // от платного "starter". Даёт 0 интеграций и полностью закрытый доступ,
      // а не 1 интеграцию, которая полагается реальному тарифу starter.
      const resetPayload = {
        plan: null,
        access_status: "expired",
        current_period_end: null,
        integrations_selected: [],
      };

      await admin.from("subscriptions").update(resetPayload).eq("user_id", appUser.id);

      // Телеграм отвязываем всегда — вне зависимости от того, есть ли businesses.
      await admin.from("users").update({ telegram_id: null }).eq("id", appUser.id);

      // Интеграции гасим только для business'ов этого юзера. Ключи (api_key_encrypted)
      // не трогаем намеренно — чтобы при апгрейде юзеру не пришлось искать их заново,
      // только меняем status на inactive.
      const { data: businesses } = await admin
        .from("businesses")
        .select("id")
        .eq("user_id", appUser.id);

      const businessIds = (businesses || []).map((b) => b.id);
      if (businessIds.length > 0) {
        await admin
          .from("integrations")
          .update({ status: "inactive" })
          .in("business_id", businessIds);
      }

      return Response.json(
        { ...sub, ...resetPayload, is_blocked: false },
        { headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    if (sub.access_status !== "blocked") {
      await admin
        .from("subscriptions")
        .update({ access_status: "blocked" })
        .eq("user_id", appUser.id);
    }

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