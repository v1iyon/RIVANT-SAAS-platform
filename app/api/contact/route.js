import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function POST(req) {
  const { name, company, email, telegram, message, source } = await req.json();
  if (!name || !email) {
    return Response.json({ error: "missing fields" }, { status: 400 });
  }

  // Пишем лид в базу до отправки писем — так заявка не теряется,
  // даже если Resend временно недоступен.
  try {
    const { error: insertError } = await admin.from("leads").insert({
      name,
      company: company || null,
      email,
      telegram: telegram || null,
      message: message || null,
      source: source || "contact_form",
    });
    if (insertError) {
      console.error("leads insert failed:", insertError.message);
    }
  } catch (e) {
    console.error("leads insert error:", e);
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "RIVANT Contact <onboarding@resend.dev>",
      to: process.env.CONTACT_EMAIL,
      reply_to: email,
      subject: `New demo request from ${name} (${company || "no company"})`,
      text: `Name: ${name}\nCompany: ${company || "—"}\nEmail: ${email}\nTelegram: ${telegram || "—"}\n\n${message || "(requested a demo via contact form)"}`,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return Response.json({ error: "email send failed", details: err }, { status: 500 });
  }

  // Автоответ самому отправителю. Не должен ронять основной запрос —
  // лид уже доставлен вам письмом выше, это просто вежливое "получили".
  // Пока домен в Resend не подтверждён (см. пункт 1.8 плана), это письмо
  // может не долетать до реального ящика человека — Resend в тестовом
  // режиме шлёт только на адрес, зарегистрированный в самом Resend.
  try {
    const autoReplyRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "RIVANT <onboarding@resend.dev>",
        to: email,
        subject: "We've received your request — RIVANT",
        text: `Hi,\n\nThanks for reaching out to RIVANT. We've received your request and will get back to you within 24 hours.\n\nIf it's urgent, you can also message us directly on Telegram: https://t.me/official_rivant\n\n— RIVANT Team`,
      }),
    });
    if (!autoReplyRes.ok) {
      const err = await autoReplyRes.text();
      console.error("auto-reply email failed:", err);
    }
  } catch (e) {
    console.error("auto-reply email error:", e);
  }

  return Response.json({ ok: true });
}