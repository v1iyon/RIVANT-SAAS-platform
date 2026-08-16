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
import crypto from "crypto";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const PRICE_TO_ADDON = {
  [process.env.PADDLE_PRICE_WHATIF]: { kind: "order", service_type: "whatif_analysis" },
  [process.env.PADDLE_PRICE_MONTHLY_DIGEST]: { kind: "subscription", addon_type: "monthly_digest" },
  [process.env.PADDLE_PRICE_TEAM_ALERTS]: { kind: "subscription", addon_type: "team_alerts" },
};

// Основні тарифи (Starter/Growth/Scale) — ті самі priceId, що й у
// components/pricing-section.tsx (NEXT_PUBLIC_..., бо ними ж відкривається
// чекаут на клієнті). Раніше ці priceId тут взагалі не оброблялись: людина
// платила через Paddle, гроші приходили, а subscriptions.plan лишався
// "trial" назавжди, бо ніщо в коді його не оновлювало на платний план. Див.
// п. 3 аудиту.
const PRICE_TO_PLAN = {
  [process.env.NEXT_PUBLIC_PADDLE_PRICE_STARTER]: "starter",
  [process.env.NEXT_PUBLIC_PADDLE_PRICE_GROWTH]: "growth",
  [process.env.NEXT_PUBLIC_PADDLE_PRICE_SCALE]: "scale",
};

// Сколько секунд назад ещё считаем вебхук свежим. Paddle подписывает
// каждый запрос меткой времени — если кто-то перехватит старый (валидный)
// вебхук и пришлёт его повторно позже, подпись всё ещё совпадёт, если не
// проверять возраст. 5 минут — с большим запасом на сетевые задержки/ретраи
// самого Paddle, но достаточно узко, чтобы закрыть replay.
const MAX_SIGNATURE_AGE_SECONDS = 300;

async function verifyPaddleSignature(rawBody, signatureHeader) {
  // Paddle Billing подписывает вебхуки HMAC-SHA256 и присылает заголовок
  // paddle-signature в формате "ts=<unix-время>;h1=<hex-дайджест>".
  // Подписанное сообщение — это "<ts>:<rawBody>" (сырое тело запроса, ДО
  // JSON.parse — поэтому здесь работаем со строкой, а не с объектом).
  // См. https://developer.paddle.com/webhooks/signature-verification
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) return false;
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(";").map((pair) => {
      const [key, value] = pair.split("=");
      return [key, value];
    })
  );
  const ts = parts.ts;
  const h1 = parts.h1;
  if (!ts || !h1) return false;

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > MAX_SIGNATURE_AGE_SECONDS) {
    return false;
  }

  const expectedHex = crypto.createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest("hex");

  // timingSafeEqual требует буферы одинаковой длины — сверяем длину до
  // вызова, иначе он бросает исключение вместо false на некорректном h1
  // (например, если это вообще не валидный hex или подделанная строка
  // другой длины).
  let expectedBuf, actualBuf;
  try {
    expectedBuf = Buffer.from(expectedHex, "hex");
    actualBuf = Buffer.from(h1, "hex");
  } catch {
    return false;
  }
  if (expectedBuf.length !== actualBuf.length) return false;

  // timingSafeEqual вместо === — чтобы нельзя было подобрать h1 по времени
  // ответа сервера (та же логика, что и с ADMIN_SECRET/CRON_SECRET, см.
  // п. 2.5 аудита).
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
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

  const addonMapping = PRICE_TO_ADDON[priceId];
  const planMapping = PRICE_TO_PLAN[priceId];

  if (!email || (!addonMapping && !planMapping)) {
    console.error("paddle webhook: missing email or unknown priceId", { email, priceId });
    return Response.json({ ok: true }); // 200, щоб Paddle не ретраїв нескінченно
  }

  const { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!appUser) return Response.json({ ok: true });

  // ── Основні тарифи (Starter/Growth/Scale) ─────────────────────────────
  // На відміну від допуслуг, вони прив'язані до user_id (subscriptions —
  // одна строка на юзера), а не до business_id, тому business_id тут не
  // обов'язковий. Значення access_status/plan тримаємо в синку з тим, що
  // читає app/api/subscription-status/route.js.
  if (planMapping) {
    if (
      eventType === "subscription.created" ||
      eventType === "subscription.activated" ||
      eventType === "subscription.updated" ||
      eventType === "transaction.completed"
    ) {
      const periodEnd = data.current_billing_period?.ends_at || data.next_billed_at || null;
      const { data: existingSub } = await admin
        .from("subscriptions")
        .select("user_id")
        .eq("user_id", appUser.id)
        .maybeSingle();

      const payload = {
        plan: planMapping,
        access_status: "active",
        current_period_end: periodEnd,
        paddle_subscription_id: data.subscription_id || data.id,
      };

      if (existingSub) {
        await admin.from("subscriptions").update(payload).eq("user_id", appUser.id);
      } else {
        await admin.from("subscriptions").insert({ user_id: appUser.id, ...payload });
      }
    }

    if (eventType === "subscription.canceled" || eventType === "subscription.past_due") {
      // Не чіпаємо plan/current_period_end — access_status: "blocked" вже
      // достатньо, щоб subscription-status/route.js відрізав доступ; коли
      // період справді закінчиться, та сама логіка обробить це так само,
      // як і для щойно завершеного тріалу.
      await admin.from("subscriptions").update({ access_status: "blocked" }).eq("user_id", appUser.id);
    }

    return Response.json({ ok: true });
  }

  // ── Допуслуги (What-If / Monthly digest / Team alerts) ────────────────
  // Ці завжди прив'язані до конкретного business_id.
  if (!businessId) {
    console.error("paddle webhook: addon event missing business_id", { email, priceId });
    return Response.json({ ok: true });
  }

  if (eventType === "transaction.completed" && addonMapping.kind === "order") {
    // Разова допуслуга (What-If) — створюємо замовлення, яке підхопить
    // app/api/cron/process-service-orders і згенерує звіт автоматично.
    await admin.from("service_orders").insert({
      business_id: businessId,
      user_id: appUser.id,
      service_type: addonMapping.service_type,
      status: "pending",
      paddle_transaction_id: data.id,
    });
  }

  if (
    (eventType === "subscription.created" || eventType === "subscription.activated" || eventType === "transaction.completed") &&
    addonMapping.kind === "subscription"
  ) {
    const periodEnd = data.current_billing_period?.ends_at || data.next_billed_at;
    await admin.from("addon_subscriptions").upsert(
      {
        business_id: businessId,
        addon_type: addonMapping.addon_type,
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
      .eq("addon_type", addonMapping.addon_type);
  }

  return Response.json({ ok: true });
}