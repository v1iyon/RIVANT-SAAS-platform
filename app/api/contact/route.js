export async function POST(req) {
  const { name, company, email, telegram, message } = await req.json();
  if (!name || !email) {
    return Response.json({ error: "missing fields" }, { status: 400 });
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

  return Response.json({ ok: true });
}