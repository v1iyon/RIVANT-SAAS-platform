// app/api/team/invite/route.js
//
// Вызывается из кабинета кнопкой "Запросити учасника команди".
// Отдаёт deep-link на бота: https://t.me/rivant_os_bot?start=tm_<token>
// bot.js (см. /start handler) отличает tm_-токены от обычных link_tokens
// и вставляет запись в team_members вместо users.telegram_id.

import { createClient } from "@supabase/supabase-js";
import { ALERT_CATEGORIES } from "@/lib/alerts.mjs";
import { requireUser, UnauthorizedError } from "@/lib/require-user";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const TEAM_MEMBER_LIMIT = 10; // защита от злоупотребления одной ссылкой

// Владелец выбирает категории ПРИ создании ссылки (например, "только
// inventory" для логиста). Если фронт ничего не передал — оставляем
// поведение как раньше (человек видит всё), а не молча режем доступ.
function sanitizeCategories(input) {
  if (!Array.isArray(input) || input.length === 0) return ALERT_CATEGORIES;
  const valid = input.filter((c) => ALERT_CATEGORIES.includes(c));
  return valid.length ? valid : ALERT_CATEGORIES;
}

export async function POST(req) {
  const { categories } = await req.json();
  let email;
  try {
    ({ email } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }
  const safeCategories = sanitizeCategories(categories);

  const { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!appUser) return Response.json({ error: "user not found" }, { status: 404 });

  // Той самий детермінований фікс, що і в /api/business-profile та
  // /api/team/members — без order() при кількох рядках businesses вибір
  // непередбачуваний.
  const { data: business } = await admin
    .from("businesses")
    .select("id")
    .eq("user_id", appUser.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!business) return Response.json({ error: "business not found" }, { status: 404 });

  // Без активної підписки на "Сповіщення для команди" — інвайт не видаємо.
  // Так само як і в bot.js при активації токена (подвійна перевірка: тут —
  // щоб не генерувати марні посилання, там — бо посилання могло "протухнути"
  // між генерацією і кліком, якщо підписка скасувалась саме в цей момент).
  const { data: addon } = await admin
    .from("addon_subscriptions")
    .select("status, current_period_end")
    .eq("business_id", business.id)
    .eq("addon_type", "team_alerts")
    .maybeSingle();

  if (!addon || addon.status !== "active" || new Date(addon.current_period_end) < new Date()) {
    return Response.json(
      { error: "no_active_subscription", message: "Підписка «Сповіщення для команди» не активна" },
      { status: 403 }
    );
  }

  const { count } = await admin
    .from("team_members")
    .select("id", { count: "exact", head: true })
    .eq("business_id", business.id)
    .eq("status", "active");

  if ((count || 0) >= TEAM_MEMBER_LIMIT) {
    return Response.json({ error: "limit_reached", message: `Максимум ${TEAM_MEMBER_LIMIT} учасників` }, { status: 403 });
  }

  const token = "tm_" + crypto.randomUUID();
  const { error } = await admin.from("team_invites").insert({
    token,
    business_id: business.id,
    created_by: appUser.id,
    categories: safeCategories,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ url: `https://t.me/rivant_os_bot?start=${token}` });
}