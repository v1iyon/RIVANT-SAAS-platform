// app/api/orders/create/route.js
//
// Единая точка входа для кнопки "Замовити послугу" на pricing-section.
// Пока PAYMENTS_ENABLED !== "true" (нет ФОП/Paddle не подключен) — просто
// фиксируем лид и шлём тебе уведомление в Telegram, как и с trial-prompt.
// Когда включишь оплату — тот же клиентский код вызывает этот же route,
// но здесь дальше сработает ветка с paddlePriceId, отдающая клиенту priceId
// для openPaddleCheckout (компонент сам откроет чекаут).
//
// serviceType: "business_setup" | "whatif_analysis" | "monthly_digest" | "team_alerts"

import { createClient } from "@supabase/supabase-js";
import { requireUser, UnauthorizedError } from "@/lib/require-user";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const PADDLE_PRICE_BY_SERVICE = {
  whatif_analysis: process.env.PADDLE_PRICE_WHATIF,
  monthly_digest: process.env.PADDLE_PRICE_MONTHLY_DIGEST,
  team_alerts: process.env.PADDLE_PRICE_TEAM_ALERTS,
};

// business_setup навмисно немає в мапі — це ручна послуга (онбординг),
// вона завжди веде на бронювання дзвінка, навіть коли оплата вже підключена.
const CALENDAR_BOOKING_URL = process.env.CALENDAR_BOOKING_URL || "https://cal.com/rivant/onboarding";

export async function POST(req) {
  const { serviceType } = await req.json();
  let email;
  try {
    ({ email } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }
  if (!serviceType) return Response.json({ error: "missing fields" }, { status: 400 });

  if (serviceType === "business_setup") {
    return Response.json({ mode: "redirect", url: CALENDAR_BOOKING_URL });
  }

  const paymentsEnabled = process.env.PAYMENTS_ENABLED === "true";
  const priceId = PADDLE_PRICE_BY_SERVICE[serviceType];

  if (paymentsEnabled && priceId) {
    const { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    const { data: business } = appUser
      ? await admin.from("businesses").select("id").eq("user_id", appUser.id).order("created_at", { ascending: true }).limit(1).maybeSingle()
      : { data: null };

    // Компонент викличе loadPaddle()/openPaddleCheckout() з цими даними
    // на клієнті — тут ми тільки готуємо customData для вебхука.
    return Response.json({
      mode: "checkout",
      priceId,
      customData: { email, business_id: business?.id || null, service: serviceType },
    });
  }

  // --- Ещё нет оплаты: фиксируем лид тем же паттерном, что и /api/contact ---
  try {
    await admin.from("leads").insert({
      name: email.split("@")[0],
      email,
      message: `Заявка на допуслугу: ${serviceType}`,
      source: `addon_${serviceType}`,
    });
  } catch (e) {
    console.error("orders/create: lead insert failed", e);
  }

  if (process.env.ADMIN_TELEGRAM_ID && process.env.BOT_TOKEN) {
    await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.ADMIN_TELEGRAM_ID,
        text: `💰 Заявка на допуслугу "${serviceType}" від ${email}. Оплата ще не підключена — зв'яжись вручну.`,
      }),
    });
  }

  return Response.json({ mode: "lead_captured" });
}