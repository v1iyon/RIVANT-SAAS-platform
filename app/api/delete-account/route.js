import { createClient } from "@supabase/supabase-js";
import { requireUser, UnauthorizedError } from "@/lib/require-user";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function POST(req) {
  // email больше не берём из body — это самая опасная из дыр п. 1.1:
  // раньше зная чужой email можно было необратимо удалить чужой аккаунт
  // целиком, без входа в него.
  let email, authUserId;
  try {
    ({ email, id: authUserId } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }

  const { data: user } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!user) return Response.json({ error: "Account not found" }, { status: 404 });

  // ФІКС (аудит #2, знахідка №8): userId нижче — це public.users.id,
  // потрібен для чистки ВСІХ таблиць застосунку (вони посилаються саме на
  // нього). Але для видалення логіну через admin.auth.admin.deleteUser()
  // потрібен auth.users.id — це ДРУГИЙ, окремий UUID (задокументовано і в
  // create-order/index.ts через колонку auth_user_id). Раніше сюди
  // помилково передавався public.users.id: усі дані стирались, але
  // Auth-логін лишався — людина могла й далі залогінитись тим самим
  // паролем після "Видалити акаунт". authUserId беремо напряму з
  // requireUser() (auth.getUser().id), а не з таблиці users.
  const userId = user.id;

  try {
    // Бизнесы пользователя — интеграции/метрики/алерты чистим явно,
    // на случай если в базе не настроен cascade delete для этих связей.
    const { data: businesses } = await admin.from("businesses").select("id").eq("user_id", userId);
    const businessIds = (businesses || []).map((b) => b.id);

    if (businessIds.length) {
      await admin.from("integrations").delete().in("business_id", businessIds);
      await admin.from("metrics_computed").delete().in("business_id", businessIds);
      await admin.from("alerts_log").delete().in("business_id", businessIds);
      // Эти три таблицы тоже завязаны на business_id этого пользователя и
      // раньше не чистились: expenses (используется в /api/metrics для
      // CAC/расходов), team_members (personal data — telegram_id/username
      // приглашённых коллег), addon_subscriptions (допуслуга "Сповіщення
      // для команди"). Без этого после "Удалить аккаунт" в базе годами
      // оставались висячие строки с чужими данными — это уже вопрос не
      // только аккуратности, но и полноты права на удаление (GDPR).
      await admin.from("expenses").delete().in("business_id", businessIds);
      await admin.from("team_members").delete().in("business_id", businessIds);
      await admin.from("addon_subscriptions").delete().in("business_id", businessIds);
      await admin.from("businesses").delete().in("id", businessIds);
    }

    await admin.from("subscriptions").delete().eq("user_id", userId);
    await admin.from("user_widget_prefs").delete().eq("user_id", userId);
    await admin.from("feedback").delete().eq("user_id", userId);
    await admin.from("reviews").delete().eq("email", email);
    await admin.from("leads").delete().eq("email", email);

    // Сама запись пользователя в нашей таблице
    await admin.from("users").delete().eq("id", userId);

    // И сам логин в Supabase Auth — без этого человек мог бы снова
    // войти с тем же email/паролем, хотя все данные уже удалены.
    // ФІКС (знахідка №8): правильний auth.users.id + перевірка помилки
    // (раніше повертана помилка взагалі нігде не перевірялась).
    const { error: authDeleteErr } = await admin.auth.admin.deleteUser(authUserId);
    if (authDeleteErr) {
      console.error("delete-account: failed to delete auth user:", authDeleteErr.message);
      return Response.json(
        { error: "Account data deleted, but login removal failed — contact support" },
        { status: 500 }
      );
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error("delete-account error:", err);
    return Response.json({ error: "Failed to delete account, please contact support" }, { status: 500 });
  }
}