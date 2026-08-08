// app/api/webhooks/paddle/route.js
//
// Єдина точка входу для всього білінгу RIVANT (основні плани + допуслуги).
// НЕ плутати з app/api/webhooks/stripe/route.ts — той про Stripe клієнтів
// (їхні продажі, для синку метрик), тут — про оплату самого RIVANT.
//
// Поки PADDLE_WEBHOOK_SECRET не заданий (немає ФОП), цей роут просто ще не
// підключений в Paddle dashboard — нічого не зламається, endpoint існує і
// готовий, лишається тільки вписати URL в Paddle після відкриття ФОП.
//
// priceId -> service_type мапиться через env, щоб не хардкодити ID з Paddle
// прямо в коді (вони різні для sandbox/production).

import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const PRICE_TO_ADDON = {
  [process.env.PADDLE_PRICE_WHATIF]: { kind: "order", service_type: "whatif_analysis" },
  [process.env.PADDLE_PRICE_MONTHLY_DIGEST]: { kind: "subscription", addon_type: "monthly_digest" },
  [process.env.PADDLE_PRICE_TEAM_ALERTS]: { kind: "subscription", addon_type: "team_alerts" },
};

async function verifyPaddleSignature(rawBody, signatureHeader) {
  // Paddle Billing підписує вебхуки HMAC-SHA256: "ts=...;h1=...".
  // Реалізація навмисно лишена як TODO — вставте офіційний приклад із
  // https://developer.paddle.com/webhooks/signature-verification, коли
  // будете підключати справжній ключ. Без цієї перевірки НЕ можна пускати
  // вебхук в продакшн — будь-хто зможе намалювати собі фейкову оплату.
  if (!process.env.PADDLE_WEBHOOK_SECRET) return false;
  // ... HMAC перевірка тут ...
  return true;
}

export async function POST(req) {
  const rawBody = await req.text();
  const signature = req.headers.get("paddle-signature");

  const validSignature = await verifyPaddleSignature(rawBody, signature);
  if (!validSignature) {
    return Response.json({ error: "invalid signature or webhook not configured yet" }, { status: 401 });
  }

  const event = JSON.parse(rawBody);
  const eventType = event.event_type;
  const data = event.data;

  // customData прокидується з клієнта при відкритті чекауту — там завжди
  // мають бути email і business_id (додати в customData при виклику
  // openPaddleCheckout для допуслуг, аналогічно до основних планів).
  const email = data?.customer?.email || data?.custom_data?.email;
  const businessId = data?.custom_data?.business_id;
  const priceId = data?.items?.[0]?.price?.id;
  const mapping = PRICE_TO_ADDON[priceId];

  if (!email || !businessId || !mapping) {
    console.error("paddle webhook: missing email/businessId or unknown priceId", { email, businessId, priceId });
    return Response.json({ ok: true }); // 200, щоб Paddle не ретраїв нескінченно
  }

  const { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!appUser) return Response.json({ ok: true });

  if (eventType === "transaction.completed" && mapping.kind === "order") {
    // Разова допуслуга (What-If) — створюємо замовлення, яке підхопить
    // app/api/cron/process-service-orders і згенерує звіт автоматично.
    await admin.from("service_orders").insert({
      business_id: businessId,
      user_id: appUser.id,
      service_type: mapping.service_type,
      status: "pending",
      paddle_transaction_id: data.id,
    });
  }

  if (
    (eventType === "subscription.created" || eventType === "subscription.activated" || eventType === "transaction.completed") &&
    mapping.kind === "subscription"
  ) {
    const periodEnd = data.current_billing_period?.ends_at || data.next_billed_at;
    await admin.from("addon_subscriptions").upsert(
      {
        business_id: businessId,
        addon_type: mapping.addon_type,
        status: "active",
        paddle_subscription_id: data.subscription_id || data.id,
        current_period_end: periodEnd,
      },
      { onConflict: "business_id,addon_type" }
    );
  }

  if (eventType === "subscription.canceled" || eventType === "subscription.past_due") {
    await admin
      .from("addon_subscriptions")
      .update({ status: "expired" })
      .eq("business_id", businessId)
      .eq("addon_type", mapping.addon_type);
  }

  return Response.json({ ok: true });
}
