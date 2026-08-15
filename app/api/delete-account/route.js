import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function POST(req) {
  const { email } = await req.json();
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const { data: user } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!user) return Response.json({ error: "Account not found" }, { status: 404 });

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
    await admin.from("feedback").delete().eq("user_id", userId);
    await admin.from("reviews").delete().eq("email", email);
    await admin.from("leads").delete().eq("email", email);

    // Сама запись пользователя в нашей таблице
    await admin.from("users").delete().eq("id", userId);

    // И сам логин в Supabase Auth — без этого человек мог бы снова
    // войти с тем же email/паролем, хотя все данные уже удалены.
    await admin.auth.admin.deleteUser(userId);

    return Response.json({ success: true });
  } catch (err) {
    console.error("delete-account error:", err);
    return Response.json({ error: "Failed to delete account, please contact support" }, { status: 500 });
  }
}