import { createClient } from "@supabase/supabase-js";
import { requireUser, UnauthorizedError } from "@/lib/require-user";
import { ensureTrial } from "@/lib/ensure-trial";

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

    // ФІКС (аудит #2, знахідка №14): та сама lib/ensure-trial.js, що й у
    // subscription-status/route.js — раніше тут була окрема копія цієї
    // логіки (і, на відміну від subscription-status, помилка insert
    // взагалі не перевірялась).
    const { error: trialErr } = await ensureTrial(appUser.id);
    if (trialErr) {
      console.error("telegram-connect: failed to create trial subscription:", trialErr);
    }
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