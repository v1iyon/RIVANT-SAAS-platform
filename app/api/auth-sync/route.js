import { createClient } from "@supabase/supabase-js";
import { getSessionUser } from "@/lib/require-user";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// auth-sync — особый случай в списке п.1.1: его вызывают в двух местах —
// (a) сразу после supabase.auth.signUp() (components/navbar.tsx), когда
//     сессии ЕЩЁ НЕТ — в проекте включено подтверждение email ("Please
//     confirm your email before signing in" в navbar.tsx), значит между
//     signUp() и подтверждением ссылки в письме auth.getSession() отдаёт
//     null. Требовать здесь сессию сломало бы регистрацию любого нового
//     пользователя.
// (b) при каждом заходе в дашборд (app/dashboard/page.tsx) — там сессия
//     уже точно есть (код сам проверяет data.session перед вызовом).
//
// Поэтому здесь не «требуем сессию везде», а сужаем то, что можно сделать
// без неё: без сессии этот роут может только СОЗДАТЬ новую строку users
// (когда её ещё нет — ровно кейс (a), сразу после регистрации). Для уже
// существующего пользователя роут ничего не меняет (как и раньше — только
// insert для новых), но теперь ещё и не подтверждает/не отдаёт ok=true по
// чужому email без сессии — иначе это тот же класс дыры, что и везде в
// п.1.1: чужой email в body позволял бы, как минимум, подтвердить его
// существование в базе, а в будущем — стать лазейкой, если роут обрастёт
// новой логикой для существующих пользователей.
//
// ВАЖНО про subscriptions: этот роут больше НЕ создаёт триал. Раньше он
// заводил subscriptions (plan: trial, current_period_end = +14 дней) сразу
// при первом же POST без какой-либо сессии — то есть просто
// POST /api/auth-sync {"email":"victim@example.com"} запускало отсчёт
// чужого 14-дневного триала прямо сейчас, ещё до того как реальный
// владелец email вообще прошёл регистрацию. Когда он потом действительно
// регистрировался, роут находил уже существующую строку users по email и
// ничего не пересоздавал — человек получал частично или полностью
// сгоревший бесплатный период и не узнавал об этом. Единственное место,
// которое теперь заводит триал — GET /api/subscription-status, и делает
// это только для АВТОРИЗОВАННОГО пользователя (requireUser()), то есть
// часы триала стартуют в момент первого реального захода в кабинет, а не
// по произвольному POST-запросу с чужим email в теле.
export async function POST(req) {
  const { email, language } = await req.json();
  if (!email) return Response.json({ error: "email required" }, { status: 400 });
  const lang = ["EN", "DE", "UA"].includes(language) ? language : "EN";

  const sessionUser = await getSessionUser();

  let { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();

  if (!appUser) {
    const defaultName = email.split("@")[0];

    const { data: created, error } = await admin
      .from("users")
      .insert({ email, language: lang, full_name: defaultName })
      .select("id")
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    appUser = created;

    return Response.json({ ok: true });
  }

  // Пользователь уже существует. Роут его не изменяет (как и раньше), но
  // без валидной сессии, чей email совпадает с запрошенным, дальше не
  // пускаем — даже такой безобидный на вид ответ не должен подтверждать
  // существование чужого аккаунта по одному только email.
  if (!sessionUser || sessionUser.email !== email) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return Response.json({ ok: true });
}