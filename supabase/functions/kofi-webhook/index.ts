// supabase/functions/kofi-webhook/index.ts
//
// Принимает POST от Ko-fi (application/x-www-form-urlencoded), проверяет
// verification_token, парсит JSON из поля `data`, находит пользователя по
// email в public.users и активирует подписку в public.subscriptions.
//
// ВАЖНО: эта функция НЕ трогает public.orders (та таблица заточена под
// крипто-чекаут: tx_hash/chain/token) — Ko-fi платежи в неё не пишутся.
//
// Deploy:
//   supabase functions deploy kofi-webhook --no-verify-jwt
//
// Secrets (уже установлен, см. предыдущий шаг):
//   supabase secrets set KOFI_VERIFICATION_TOKEN=xxxxx

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// ---------------------------------------------------------------
// Payload от Ko-fi (см. https://ko-fi.com/manage/webhooks)
// ---------------------------------------------------------------
interface KofiPayload {
  verification_token: string;
  message_id: string;
  timestamp: string;
  type: "Donation" | "Subscription" | "Commission" | "Shop Order";
  is_public: boolean;
  from_name: string;
  message: string | null;
  amount: string; // строка вида "299.00"
  url: string;
  email: string;
  currency: string;
  kofi_transaction_id: string;
  shop_items: { direct_link_code: string; variation_name: string; quantity: number }[] | null;
  tier_name: string | null; // для Membership/Subscription
  is_subscription_payment: boolean;
  is_first_subscription_payment: boolean;
}

// ---------------------------------------------------------------
// Маппинг Ko-fi Tier -> plans.id из вашей БД.
// ВНИМАНИЕ: тир в Ko-fi называется "Scale", но в таблице `plans`
// его id — "premium" (несовпадение видно на самой странице:
// display_name="Premium", а на сайте показывается как "Scale").
// Если переименуете тир в Ko-fi — поправьте ключ слева.
// ---------------------------------------------------------------
const TIER_TO_PLAN_ID: Record<string, { plan_id: string; amount_cents: number }> = {
  "Starter": { plan_id: "starter", amount_cents: 9900 },
  "Growth": { plan_id: "growth", amount_cents: 29900 },
  "Scale": { plan_id: "premium", amount_cents: 49900 },
};

// Ko-fi Shop Item direct_link_code -> plan_id. Это самый надёжный способ
// матчинга (в отличие от суммы, код ссылки не может "случайно совпасть"),
// приходит в payload.shop_items[0].direct_link_code для типа "Shop Order".
// Коды взяты из реальных ссылок:
//   Starter -> https://ko-fi.com/s/10eb6d89bf
//   Growth  -> https://ko-fi.com/s/9dcfdf1c5b
//   Scale   -> https://ko-fi.com/s/ed50f0bf6a
const DIRECT_LINK_CODE_TO_PLAN_ID: Record<string, string> = {
  "10eb6d89bf": "starter",
  "9dcfdf1c5b": "growth",
  "ed50f0bf6a": "premium",
};

// ---------------------------------------------------------------
// Допуслуги (addon-товары) — отдельная ветка от тарифов Starter/Growth/Scale
// выше. Названия service_type/addon_type взяты 1-в-1 из PRICE_TO_ADDON в
// app/api/webhooks/paddle/route.js, чтобы cron/process-service-orders,
// cron/addon-expiry и api/team/invite узнавали эти записи без изменений.
// ---------------------------------------------------------------
type AddonMapping =
  | { kind: "order"; service_type: string }
  | { kind: "subscription"; addon_type: string };

const DIRECT_LINK_CODE_TO_ADDON: Record<string, AddonMapping> = {
  "41ec6cf444": { kind: "order", service_type: "whatif_analysis" }, // AI Historical Analysis — разовая
  "cfa88bffb3": { kind: "subscription", addon_type: "monthly_digest" }, // AI Performance Digest — ежемесячная
  "a6db84895c": { kind: "subscription", addon_type: "team_alerts" }, // Team Alert Access — ежемесячная
};

const SUBSCRIPTION_DAYS = 30;

// Только эти типы событий Ko-fi считаем платежом за тариф. "Donation"
// намеренно исключён: донат на произвольную сумму без tier_name/shop_items
// не должен активировать подписку только потому, что сумма случайно
// совпала с ценой тарифа (см. п.4 разбора).
const PLAN_PAYMENT_TYPES: KofiPayload["type"][] = ["Subscription", "Shop Order"];

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function resolvePlan(payload: KofiPayload): { plan_id: string; amount_cents: number } | null {
  // 1) Самый надёжный способ: код Shop Item из ссылки.
  const itemCode = payload.shop_items?.[0]?.direct_link_code;
  if (itemCode && DIRECT_LINK_CODE_TO_PLAN_ID[itemCode]) {
    const planId = DIRECT_LINK_CODE_TO_PLAN_ID[itemCode];
    const byPlanId = Object.values(TIER_TO_PLAN_ID).find((t) => t.plan_id === planId);
    if (byPlanId) return byPlanId;
  }

  // 2) Membership Tier (если когда-нибудь переключитесь на Tiers вместо Shop Items).
  if (payload.tier_name && TIER_TO_PLAN_ID[payload.tier_name]) {
    return TIER_TO_PLAN_ID[payload.tier_name];
  }
  if (payload.shop_items && payload.shop_items.length > 0) {
    const name = payload.shop_items[0].variation_name;
    if (name && TIER_TO_PLAN_ID[name]) return TIER_TO_PLAN_ID[name];
  }

  // 3) Фоллбэк по сумме — только для Subscription/Shop Order (уже отфильтровано
  // выше через PLAN_PAYMENT_TYPES), когда ни код, ни имя тира не пришли.
  const amountCents = Math.round(parseFloat(payload.amount) * 100);
  const byAmount = Object.values(TIER_TO_PLAN_ID).find((t) => t.amount_cents === amountCents);
  return byAmount ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const KOFI_VERIFICATION_TOKEN = Deno.env.get("KOFI_VERIFICATION_TOKEN");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!KOFI_VERIFICATION_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing required environment secrets");
    return jsonResponse({ error: "Server misconfiguration" }, 500);
  }

  // ---------------------------------------------------------------
  // 1. Парсим form-urlencoded, достаём поле `data`
  // ---------------------------------------------------------------
  let rawData: string | null;
  try {
    const form = await req.formData();
    rawData = form.get("data") as string | null;
  } catch (err) {
    console.error("Failed to parse form body:", err);
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  if (!rawData) {
    return jsonResponse({ error: "Missing 'data' field" }, 400);
  }

  let payload: KofiPayload;
  try {
    payload = JSON.parse(rawData);
  } catch (err) {
    console.error("Failed to parse JSON from 'data' field:", err);
    return jsonResponse({ error: "Invalid JSON in 'data' field" }, 400);
  }

  // ---------------------------------------------------------------
  // 2. Строгая сверка verification_token
  // ---------------------------------------------------------------
  if (payload.verification_token !== KOFI_VERIFICATION_TOKEN) {
    console.warn("Invalid Ko-fi verification_token received");
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  if (!PLAN_PAYMENT_TYPES.includes(payload.type)) {
    return jsonResponse({ message: "Ignored: unsupported type" }, 200);
  }

  const email = payload.email?.toLowerCase().trim();
  if (!email) {
    return jsonResponse({ error: "Missing buyer email" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ---------------------------------------------------------------
  // 3. Идемпотентность: если этот kofi_transaction_id уже обработан — выходим.
  //    (Ko-fi ретраит вебхук, если не получил 200 вовремя.)
  // ---------------------------------------------------------------
  const { error: dedupeError } = await supabase
    .from("kofi_transactions")
    .insert({
      kofi_transaction_id: payload.kofi_transaction_id,
      email,
      raw_payload: payload,
    });

  if (dedupeError) {
    if (dedupeError.code === "23505") {
      // unique_violation — уже обработали этот платёж ранее
      console.log(`Duplicate Ko-fi transaction ${payload.kofi_transaction_id}, skipping`);
      return jsonResponse({ message: "Already processed" }, 200);
    }
    console.error("Failed to log kofi transaction:", dedupeError);
    return jsonResponse({ error: "Internal error" }, 500);
  }

  // ---------------------------------------------------------------
  // 3.5. Допуслуга? (AI Historical Analysis / Performance Digest / Team
  // Alert Access) — проверяем ДО resolvePlan(), это отдельная ветка,
  // которая не пересекается с тарифами Starter/Growth/Scale.
  // ---------------------------------------------------------------
  const addonItemCode = payload.shop_items?.[0]?.direct_link_code;
  const addonMapping = addonItemCode ? DIRECT_LINK_CODE_TO_ADDON[addonItemCode] : undefined;

  if (addonMapping) {
    // Находим юзера по email (та же логика, что и для тарифов ниже).
    const { data: addonUserRow, error: addonUserError } = await supabase
      .from("users")
      .select("id")
      .ilike("email", email)
      .maybeSingle();

    if (addonUserError) {
      console.error("Error looking up user by email (addon):", addonUserError);
      return jsonResponse({ error: "Internal lookup error" }, 500);
    }

    if (!addonUserRow) {
      console.warn(`No matching user for addon email ${email}`);
      await supabase.from("error_logs").insert({
        source: "kofi-webhook",
        message: "Ko-fi addon payment received but no matching user found",
        details: JSON.stringify({ email, addon: addonMapping, kofi_transaction_id: payload.kofi_transaction_id }),
        resolved: false,
      });
      return jsonResponse({ message: "No matching user, logged for manual review" }, 200);
    }

    const addonUserId = addonUserRow.id as string;

    // У Ko-fi (в отличие от Paddle custom_data) нет способа передать
    // business_id прямо в чекауте — резолвим по users->businesses. Если у
    // юзера ровно один бизнес, берём его; если 0 или больше 1 — не гадаем,
    // логируем для ручной разборки в админке.
    const { data: userBusinesses, error: businessesError } = await supabase
      .from("businesses")
      .select("id")
      .eq("user_id", addonUserId);

    if (businessesError) {
      console.error("Error looking up businesses for addon:", businessesError);
      return jsonResponse({ error: "Internal lookup error" }, 500);
    }

    if (!userBusinesses || userBusinesses.length !== 1) {
      console.warn(`Ambiguous business_id for addon: user=${addonUserId}, count=${userBusinesses?.length ?? 0}`);
      await supabase.from("error_logs").insert({
        source: "kofi-webhook",
        message: "Ko-fi addon payment: could not resolve a single business_id for user",
        details: JSON.stringify({
          user_id: addonUserId,
          business_count: userBusinesses?.length ?? 0,
          addon: addonMapping,
          kofi_transaction_id: payload.kofi_transaction_id,
        }),
        resolved: false,
      });
      return jsonResponse({ message: "Ambiguous business, logged for manual review" }, 200);
    }

    const businessId = userBusinesses[0].id as string;

    if (addonMapping.kind === "order") {
      // Разовая допуслуга — создаём заказ, cron/process-service-orders его
      // подхватит и сгенерирует отчёт, как и для Paddle-заказов.
      // paddle_transaction_id в service_orders — nullable, для Kofi-заказов
      // намеренно не заполняем (сама транзакция уже сохранена в
      // kofi_transactions.raw_payload, этого достаточно для трассировки).
      const { error: orderError } = await supabase.from("service_orders").insert({
        business_id: businessId,
        user_id: addonUserId,
        service_type: addonMapping.service_type,
        status: "pending",
      });

      if (orderError) {
        console.error("Failed to insert service_orders (kofi addon):", orderError);
        await supabase.from("error_logs").insert({
          source: "kofi-webhook",
          message: "Failed to create service_order for Ko-fi addon payment",
          details: JSON.stringify({ business_id: businessId, addon: addonMapping, error: orderError.message }),
          resolved: false,
        });
        return jsonResponse({ error: "Failed to create service order" }, 500);
      }
    } else {
      // Ежемесячная допуслуга — та же модель "ручное продление раз в 30
      // дней", что уже используется для тарифов Starter/Growth/Scale выше
      // (Ko-fi Shop-ссылки не дают настоящей авто-рекуррентности).
      // paddle_subscription_id в addon_subscriptions — nullable, для Kofi
      // не заполняем по той же причине, что и выше.
      const addonPeriodEnd = new Date(Date.now() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { error: addonSubError } = await supabase.from("addon_subscriptions").upsert(
        {
          business_id: businessId,
          addon_type: addonMapping.addon_type,
          status: "active",
          current_period_end: addonPeriodEnd,
        },
        { onConflict: "business_id,addon_type" },
      );

      if (addonSubError) {
        console.error("Failed to upsert addon_subscriptions (kofi addon):", addonSubError);
        await supabase.from("error_logs").insert({
          source: "kofi-webhook",
          message: "Failed to activate addon_subscription for Ko-fi addon payment",
          details: JSON.stringify({ business_id: businessId, addon: addonMapping, error: addonSubError.message }),
          resolved: false,
        });
        return jsonResponse({ error: "Failed to activate addon subscription" }, 500);
      }
    }

    console.log(`Addon activated via Ko-fi: business=${businessId}, addon=${JSON.stringify(addonMapping)}`);
    return jsonResponse({ message: "Addon activated" }, 200);
  }

  // ---------------------------------------------------------------
  // 4. Определяем тариф
  // ---------------------------------------------------------------
  const plan = resolvePlan(payload);
  if (!plan) {
    console.warn("Could not resolve plan for tier_name:", payload.tier_name, "amount:", payload.amount);
    await supabase.from("error_logs").insert({
      source: "kofi-webhook",
      message: "Unrecognized Ko-fi tier/amount",
      details: JSON.stringify({ tier_name: payload.tier_name, amount: payload.amount, email }),
      resolved: false,
    });
    return jsonResponse({ error: "Unrecognized tier/amount" }, 422);
  }

  // ---------------------------------------------------------------
  // 5. Находим пользователя по email в public.users
  // ---------------------------------------------------------------
  const { data: userRow, error: userError } = await supabase
    .from("users")
    .select("id")
    .ilike("email", email)
    .maybeSingle();

  if (userError) {
    console.error("Error looking up user by email:", userError);
    return jsonResponse({ error: "Internal lookup error" }, 500);
  }

  if (!userRow) {
    console.warn(`No matching user for email ${email}`);
    await supabase.from("error_logs").insert({
      source: "kofi-webhook",
      message: "Ko-fi payment received but no matching user found",
      details: JSON.stringify({ email, plan_id: plan.plan_id, kofi_transaction_id: payload.kofi_transaction_id }),
      resolved: false,
    });
    return jsonResponse({ message: "No matching user, logged for manual review" }, 200);
  }

  const userId = userRow.id as string;
  const periodEnd = new Date(Date.now() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // ---------------------------------------------------------------
  // 6. Upsert public.subscriptions — те же имена колонок, что и в
  //    polygon-webhook (plan_id, не `plan`; никакого provider_subscription_id
  //    — этой колонки нет в крипто-варианте upsert, и раз мы не подтвердили
  //    её существование в реальной схеме, лучше не рисковать всем upsert'ом
  //    ради поля, которое может не существовать. Kofi-транзакция и так
  //    полностью сохранена в kofi_transactions.raw_payload — этого достаточно
  //    для ручного сопоставления, если понадобится).
  // ---------------------------------------------------------------
  const now = new Date().toISOString();

  const { error: subError } = await supabase.from("subscriptions").upsert(
    {
      user_id: userId,
      plan_id: plan.plan_id,
      access_status: "active",
      current_period_end: periodEnd,
      updated_at: now, // same as polygon-webhook — don't let this column go stale for Ko-fi-paid rows
    },
    { onConflict: "user_id" },
  );

  if (subError) {
    console.error("Failed to upsert subscription:", subError);
    return jsonResponse({ error: "Failed to activate subscription" }, 500);
  }

  // ---------------------------------------------------------------
  // 7. НЕ синхронизируем public.users.has_active_subscription здесь.
  //
  //    polygon-webhook пишет доступ ТОЛЬКО в subscriptions.access_status —
  //    он не трогает users.has_active_subscription. Если бы этот блок
  //    остался только в kofi-webhook, то:
  //      - юзеры, оплатившие Ko-fi, были бы видны как активные в обоих
  //        местах (users-флаг и subscriptions);
  //      - юзеры, оплатившие crypto, — только в subscriptions.
  //    Т.е. любой код, который всё ещё читает users.has_active_subscription
  //    (а не subscriptions.access_status), видел бы крипто-платежи как
  //    "неактивные" — это ровно баг из прошлого аудита, который мы не
  //    должны тихо воспроизводить только для одного из двух путей оплаты.
  //
  //    Если по факту где-то в проекте (дашборд/админка/middleware) всё ещё
  //    читается users.has_active_subscription — раскомментируйте блок ниже
  //    И добавьте симметричный апдейт в polygon-webhook, иначе крипто-юзеры
  //    останутся "невидимыми" для этой части приложения.
  // ---------------------------------------------------------------
  // const { error: usersError } = await supabase
  //   .from("users")
  //   .update({
  //     has_active_subscription: true,
  //     subscription_expires_at: periodEnd,
  //   })
  //   .eq("id", userId);
  //
  // if (usersError) {
  //   console.error("Failed to sync users.has_active_subscription:", usersError);
  //   await supabase.from("error_logs").insert({
  //     source: "kofi-webhook",
  //     message: "Subscription activated but failed to sync users flag",
  //     details: JSON.stringify({ user_id: userId, error: usersError.message }),
  //     resolved: false,
  //   });
  // }

  console.log(`Subscription activated: user=${userId}, plan=${plan.plan_id}, until=${periodEnd}`);
  return jsonResponse({ message: "Subscription activated" }, 200);
});