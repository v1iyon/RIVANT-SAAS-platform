import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const hookSecret = Deno.env.get("SEND_EMAIL_HOOK_SECRET")!.replace("v1,whsec_", "");
const resendApiKey = Deno.env.get("RESEND_API_KEY")!;

const templates: Record<string, (code: string) => { subject: string; html: string }> = {
  UA: (code) => ({
    subject: "Підтвердіть вашу пошту",
    html: `<h2>Підтвердіть вашу пошту</h2><p>Введіть цей код, щоб завершити реєстрацію:</p><h1 style="letter-spacing:4px">${code}</h1>`,
  }),
  EN: (code) => ({
    subject: "Confirm your email",
    html: `<h2>Confirm your email</h2><p>Enter this code to finish signing up:</p><h1 style="letter-spacing:4px">${code}</h1>`,
  }),
  DE: (code) => ({
    subject: "Bestätigen Sie Ihre E-Mail",
    html: `<h2>Bestätigen Sie Ihre E-Mail</h2><p>Geben Sie diesen Code ein, um die Registrierung abzuschließen:</p><h1 style="letter-spacing:4px">${code}</h1>`,
  }),
};

// FIX (аудит preLaunch): Deno.Response для строкового тела по умолчанию
// отдаёт "text/plain;charset=UTF-8", а не "application/json". Supabase Auth
// Send Email Hook требует строго application/json в ответе — иначе GoTrue
// отклоняет ЛЮБОЙ вызов signUp()/resend() с ошибкой
// "hook_payload_invalid_content_type", даже если сам хук отработал верно и
// письмо успешно ушло через Resend. При этом попытка уже израсходована в
// счётчике Supabase — несколько таких неудачных регистраций подряд быстро
// упирались в "over_email_send_rate_limit", хотя реальных писем не уходило
// ни одного. Явно проставляем Content-Type на каждый возврат.
const JSON_HEADERS = { "Content-Type": "application/json" };

Deno.serve(async (req) => {
  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);
  const wh = new Webhook(hookSecret);

  let data: any;
  try {
    data = wh.verify(payload, headers);
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 401,
      headers: JSON_HEADERS,
    });
  }

  const { user, email_data } = data;

  // Отправляем этот кастомный шаблон только для регистрации (signup OTP).
  // Остальные типы писем (recovery, magic link, email_change и т.д.)
  // намеренно пропускаем без обработки — их продолжит слать сам Supabase
  // через стандартный механизм, если этот хук вернёт успех без действия.
  if (email_data?.email_action_type !== "signup") {
    return new Response(JSON.stringify({}), { status: 200, headers: JSON_HEADERS });
  }

  const lang = ["UA", "EN", "DE"].includes(user?.user_metadata?.language)
    ? user.user_metadata.language
    : "EN";
  const { subject, html } = templates[lang](email_data.token);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "RIVANT <hello@rivant-os.com>",
      to: [user.email],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    return new Response(JSON.stringify({ error: await res.text() }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }

  return new Response(JSON.stringify({}), { status: 200, headers: JSON_HEADERS });
});