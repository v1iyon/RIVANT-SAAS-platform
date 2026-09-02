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

Deno.serve(async (req) => {
  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);
  const wh = new Webhook(hookSecret);

  let data: any;
  try {
    data = wh.verify(payload, headers);
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 401 });
  }

  const { user, email_data } = data;

  // Отправляем этот кастомный шаблон только для регистрации (signup OTP).
  // Остальные типы писем (recovery, magic link, email_change и т.д.)
  // намеренно пропускаем без обработки — их продолжит слать сам Supabase
  // через стандартный механизм, если этот хук вернёт успех без действия.
  if (email_data?.email_action_type !== "signup") {
    return new Response(JSON.stringify({}), { status: 200 });
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
    return new Response(JSON.stringify({ error: await res.text() }), { status: 500 });
  }

  return new Response(JSON.stringify({}), { status: 200 });
});