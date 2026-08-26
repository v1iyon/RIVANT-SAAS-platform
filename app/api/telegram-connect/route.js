import { createClient } from "@supabase/supabase-js";
import { requireUser, UnauthorizedError } from "@/lib/require-user";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// п. B5 аудита: 30 минут — ссылка открывается сразу после клика на сайте,
// долгий срок жизни не нужен. Тот же стандарт, что уже применён для
// team_invites (tm_-токенов) в src/bot.js.
const LINK_TOKEN_TTL_MS = 30 * 60 * 1000;

export async function POST(req) {
  const { language } = await req.json();
  let email;
  try {
    ({ email } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }
  const lang = ["EN", "DE", "UA"].includes(language) ? language : "EN";

  let { data: appUser } = await admin
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (!appUser) {
    const { data: created, error } = await admin
      .from("users")
      .insert({ email, language: lang })
      .select("id")
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    appUser = created;

    const trialEnd = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
    await admin.from("subscriptions").insert({
      user_id: appUser.id,
      plan: "trial",
      access_status: "trial",
      current_period_end: trialEnd,
    });
  } else {
    // язык мог смениться на сайте — обновляем при каждом переподключении
    await admin.from("users").update({ language: lang }).eq("id", appUser.id);
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS).toISOString();
  const { error: tokenError } = await admin
    .from("link_tokens")
    .insert({ token, user_id: appUser.id, expires_at: expiresAt });
  if (tokenError) return Response.json({ error: tokenError.message }, { status: 500 });

  return Response.json({ url: `https://t.me/rivant_os_bot?start=${token}` });
}