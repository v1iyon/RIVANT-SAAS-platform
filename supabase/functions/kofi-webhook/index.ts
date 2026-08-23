// supabase/functions/kofi-webhook/index.ts
//
// Принимает POST от Ko-fi (application/x-www-form-urlencoded), проверяет
// verification_token, парсит JSON из поля `data`, находит пользователя по
// email в public.users и активирует подписку в public.subscriptions +
// синхронизирует public.users.has_active_subscription/subscription_expires_at.
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

const SUBSCRIPTION_DAYS = 30;

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function resolvePlan(payload: KofiPayload): { plan_id: string; amount_cents: number } | null {
  if (payload.tier_name && TIER_TO_PLAN_ID[payload.tier_name]) {
    return TIER_TO_PLAN_ID[payload.tier_name];
  }
  if (payload.shop_items && payload.shop_items.length > 0) {
    const name = payload.shop_items[0].variation_name;
    if (name && TIER_TO_PLAN_ID[name]) return TIER_TO_PLAN_ID[name];
  }
  // fallback: по сумме, если имя тира не пришло
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

  const relevantTypes = ["Subscription", "Shop Order", "Donation"];
  if (!relevantTypes.includes(payload.type)) {
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
  // 6. Upsert public.subscriptions (уникальный user_id уже гарантирован)
  // ---------------------------------------------------------------
  const { error: subError } = await supabase.from("subscriptions").upsert(
    {
      user_id: userId,
      plan: plan.plan_id,
      access_status: "active",
      current_period_end: periodEnd,
      provider_subscription_id: payload.kofi_transaction_id,
    },
    { onConflict: "user_id" },
  );

  if (subError) {
    console.error("Failed to upsert subscription:", subError);
    return jsonResponse({ error: "Failed to activate subscription" }, 500);
  }

  // ---------------------------------------------------------------
  // 7. Синхронизируем публичный флаг доступа в public.users
  //    (в БД нет триггера, который делает это автоматически — см. проверку)
  // ---------------------------------------------------------------
  const { error: usersError } = await supabase
    .from("users")
    .update({
      has_active_subscription: true,
      subscription_expires_at: periodEnd,
    })
    .eq("id", userId);

  if (usersError) {
    console.error("Failed to sync users.has_active_subscription:", usersError);
    // Подписка уже активирована, поэтому не возвращаем 500 (Ko-fi начнёт ретраить
    // и создаст новый platform-level конфликт) — просто логируем для ручного фикса.
    await supabase.from("error_logs").insert({
      source: "kofi-webhook",
      message: "Subscription activated but failed to sync users flag",
      details: JSON.stringify({ user_id: userId, error: usersError.message }),
      resolved: false,
    });
  }

  console.log(`Subscription activated: user=${userId}, plan=${plan.plan_id}, until=${periodEnd}`);
  return jsonResponse({ message: "Subscription activated" }, 200);
});