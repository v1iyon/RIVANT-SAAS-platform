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

// FIX (пароль не приходить на "Забули пароль?"): раніше recovery-листи
// (як і magic link / email change / reauth) навмисно пропускались тут із
// коментарем "їх продовжить слати сам Supabase через стандартний механізм".
// Це невірне уявлення про роботу Send Email Hook — щойно хук підключено
// в проєкті, Supabase ПОВНІСТЮ передає йому відправку УСІХ типів auth-листів,
// вбудований фолбек-механізм для необроблених типів не існує. Хук просто
// повертав 200 без жодного реального листа — форма "Забули пароль?"
// показувала "лист надіслано", хоча нічого не надсилалось.
// Посилання будуємо за офіційним форматом Supabase (verify endpoint, який
// сам звірить token_hash і зробить редірект на redirect_to з сесією):
// `${site_url}/verify?token=${token_hash}&type=${email_action_type}&redirect_to=...`
const recoveryTemplates: Record<string, (link: string) => { subject: string; html: string }> = {
  UA: (link) => ({
    subject: "Відновлення пароля RIVANT",
    html: `<h2>Відновлення пароля</h2><p>Ми отримали запит на скидання пароля для вашого акаунта RIVANT. Натисніть кнопку нижче, щоб встановити новий пароль:</p><p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Скинути пароль</a></p><p>Якщо ви не запитували скидання пароля, просто проігноруйте цей лист — ваш пароль залишиться незмінним.</p><p style="color:#888;font-size:12px">Посилання дійсне обмежений час. Якщо кнопка не працює, скопіюйте це посилання у браузер:<br>${link}</p>`,
  }),
  EN: (link) => ({
    subject: "Reset your RIVANT password",
    html: `<h2>Reset your password</h2><p>We received a request to reset the password for your RIVANT account. Click the button below to set a new password:</p><p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Reset password</a></p><p>If you didn't request a password reset, you can safely ignore this email — your password will stay the same.</p><p style="color:#888;font-size:12px">This link is valid for a limited time. If the button doesn't work, copy this link into your browser:<br>${link}</p>`,
  }),
  DE: (link) => ({
    subject: "Setzen Sie Ihr RIVANT-Passwort zurück",
    html: `<h2>Passwort zurücksetzen</h2><p>Wir haben eine Anfrage zum Zurücksetzen des Passworts für Ihr RIVANT-Konto erhalten. Klicken Sie auf die Schaltfläche unten, um ein neues Passwort festzulegen:</p><p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Passwort zurücksetzen</a></p><p>Wenn Sie kein Zurücksetzen des Passworts angefordert haben, können Sie diese E-Mail ignorieren — Ihr Passwort bleibt unverändert.</p><p style="color:#888;font-size:12px">Dieser Link ist nur begrenzte Zeit gültig. Falls die Schaltfläche nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:<br>${link}</p>`,
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

  const lang = ["UA", "EN", "DE"].includes(user?.user_metadata?.language)
    ? user.user_metadata.language
    : "EN";

  let subject: string;
  let html: string;

  if (email_data?.email_action_type === "signup") {
    ({ subject, html } = templates[lang](email_data.token));
  } else if (email_data?.email_action_type === "recovery") {
    // Офіційний формат посилання Supabase Send Email Hook: GoTrue сам
    // звірить token(_hash), встановить сесію відновлення і зробить редірект
    // на redirect_to (сторінка /reset-password вже вміє її обробити —
    // див. app/reset-password/page.tsx, onAuthStateChange -> PASSWORD_RECOVERY).
    const link = `${email_data.site_url}/verify?token=${email_data.token_hash}&type=recovery&redirect_to=${encodeURIComponent(email_data.redirect_to)}`;
    ({ subject, html } = recoveryTemplates[lang](link));
  } else {
    // Інші типи (magic link, email change, reauth, invite) наразі в
    // продукті не використовуються — якщо колись з'являться, їх треба
    // додати сюди так само явно, а не покладатись на неіснуючий фолбек.
    return new Response(JSON.stringify({}), { status: 200, headers: JSON_HEADERS });
  }

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