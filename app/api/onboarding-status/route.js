// app/api/onboarding-status/route.js
//
// Єдине джерело правди для чек-листа "завершення налаштування" на
// дашборді (components/dashboard/onboarding-checklist.tsx). Навмисно
// окремий легкий ендпоінт, а не ще один похідний прапорець, зібраний з
// business-status + integrations-status на фронті — щоб критерій
// "крок виконано" рахувався в одному місці й не розходився між
// desktop-банером і мобільним bottom sheet (обидва рендери — один
// компонент, один fetch).
//
// Кроки навмисно мінімальні (3), кожен веде до реального незробленого
// дії, а не до "заповніть про всяк випадок":
//   1. profile      — є назва бізнесу і обраний часовий пояс (без
//                      таймзони "щоденний звіт" і прогноз рахуються по
//                      UTC, а не по локальному дню власника).
//   2. integration   — підключено хоча б одне джерело доходу
//                      (REVENUE_SOURCE_PROVIDERS з lib/plan-slots.js —
//                      той самий список, яким тепер користуються
//                      /api/metrics і /api/forecast, щоб "підключено" тут
//                      означало те саме, що й "є дані" там).
//   3. telegram      — прив'язаний telegram_id (сповіщення й щоденні
//                      звіти інакше нікуди не приходять).
import { createClient } from "@supabase/supabase-js";
import { requireUser, UnauthorizedError } from "@/lib/require-user";
import { REVENUE_SOURCE_PROVIDERS } from "@/lib/plan-slots";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function emptyResponse() {
  return {
    steps: [
      { id: "profile", done: false },
      { id: "integration", done: false },
      { id: "telegram", done: false },
    ],
    completed: 0,
    total: 3,
  };
}

export async function GET(req) {
  let email;
  try {
    ({ email } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }

  const { data: appUser } = await admin.from("users").select("id, telegram_id").eq("email", email).maybeSingle();
  if (!appUser) return Response.json(emptyResponse());

  const { data: business } = await admin
    .from("businesses")
    .select("id, name, timezone")
    .eq("user_id", appUser.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!business) return Response.json(emptyResponse());

  const { data: integrations } = await admin
    .from("integrations")
    .select("provider, status")
    .eq("business_id", business.id)
    .eq("status", "connected")
    .in("provider", REVENUE_SOURCE_PROVIDERS);

  const steps = [
    // business.name завжди щось містить (заповнюється при першому
    // онбордингу), тому реальний незробений крок тут — саме timezone:
    // без нього не можна вважати профіль дійсно "своїм".
    { id: "profile", done: !!(business.name && business.timezone) },
    { id: "integration", done: !!(integrations && integrations.length > 0) },
    { id: "telegram", done: !!appUser.telegram_id },
  ];

  return Response.json({
    steps,
    completed: steps.filter((s) => s.done).length,
    total: steps.length,
  });
}
