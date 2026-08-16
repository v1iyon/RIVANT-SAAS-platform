// app/api/trial-prompt/route.js
import { createClient } from "@supabase/supabase-js";
import { getPrimaryBusinessId } from "@/lib/get-primary-business";
import { requireUser, UnauthorizedError } from "@/lib/require-user";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export async function POST(req) {
  const { response } = await req.json();
  if (!["yes", "not_now"].includes(response)) {
    return Response.json({ error: "invalid input" }, { status: 400 });
  }
  let email;
  try {
    ({ email } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }

  const { data: user } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!user) return Response.json({ error: "user not found" }, { status: 404 });

  const businessId = await getPrimaryBusinessId(admin, user.id);

  await admin.from("user_events").insert({
    user_id: user.id,
    business_id: businessId || null,
    event_type: response === "yes" ? "trial_prompt_yes" : "trial_prompt_no",
    channel: "web",
  });
  await admin.from("interest_signals").insert({
    business_id: business?.id || null,
    email,
    response,
  });

  if (response === "yes" && process.env.ADMIN_TELEGRAM_ID) {
    await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.ADMIN_TELEGRAM_ID,
        text: `🔥 Лид с сайта хочет продолжить: ${email}`,
      }),
    });
  }

  return Response.json({ ok: true });
}