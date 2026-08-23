// supabase/functions/kofi-webhook/index.ts
//
// Принимает POST-запрос от Ko-fi (application/x-www-form-urlencoded),
// проверяет verification_token, парсит JSON из поля `data`,
// матчит покупателя по email и делает upsert подписки.
//
// Deploy:
//   supabase functions deploy kofi-webhook --no-verify-jwt
//   (--no-verify-jwt обязателен: Ko-fi не отправляет Supabase JWT)
//
// Secrets:
//   supabase secrets set KOFI_VERIFICATION_TOKEN=xxxxx
//   (SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY подставляются автоматически)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// ---------------------------------------------------------------
// Типы payload'а, который Ko-fi кладёт внутрь строкового поля `data`
// (см. https://ko-fi.com/manage/webhooks)
// ---------------------------------------------------------------
interface KofiShopItem {
  direct_link_code: string;
  variation_name: string;
  quantity: number;
}

interface KofiPayload {
  verification_token: string;
  message_id: string;
  timestamp: string;
  type: "Donation" | "Subscription" | "Commission" | "Shop Order";
  is_public: boolean;
  from_name: string;
  message: string | null;
  amount: string; // строка вида "99.00"
  url: string;
  email: string;
  currency: string;
  kofi_transaction_id: string;
  shop_items: KofiShopItem[] | null;
  tier_name: string | null; // для Membership/Subscription
  is_subscription_payment: boolean;
  is_first_subscription_payment: boolean;
}

// ---------------------------------------------------------------
// Маппинг Ko-fi Tier -> внутренний plan_type
// Названия Tier должны точно совпадать с тем, что настроено в Ko-fi Shop.
// ---------------------------------------------------------------
const TIER_TO_PLAN: Record<string, { plan_type: "growth" | "premium" | "enterprise"; amount: number }> = {
  "Growth": { plan_type: "growth", amount: 99 },
  "Premium": { plan_type: "premium", amount: 299 },
  "Enterprise": { plan_type: "enterprise", amount: 499 },
};

const SUBSCRIPTION_DAYS = 30;

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Определяем plan_type: сначала пробуем tier_name (Membership), затем shop_items (разовая покупка)
function resolvePlan(payload: KofiPayload): { plan_type: "growth" | "premium" | "enterprise"; amount: number } | null {
  if (payload.tier_name && TIER_TO_PLAN[payload.tier_name]) {
    return TIER_TO_PLAN[payload.tier_name];
  }

  if (payload.shop_items && payload.shop_items.length > 0) {
    const code = payload.shop_items[0].variation_name;
    if (code && TIER_TO_PLAN[code]) {
      return TIER_TO_PLAN[code];
    }
  }

  // fallback: матчим по сумме, если названия тарифов не пришли
  const amount = parseFloat(payload.amount);
  const byAmount = Object.values(TIER_TO_PLAN).find((t) => t.amount === Math.round(amount));
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
  // 1. Парсим application/x-www-form-urlencoded, достаём поле `data`
  // ---------------------------------------------------------------
  let rawData: string | null;
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      rawData = form.get("data") as string | null;
    } else {
      // На случай если Ko-fi (или тестовый curl) пришлёт multipart/form-data
      const form = await req.formData();
      rawData = form.get("data") as string | null;
    }
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
  // 2. Строгая сверка verification_token (защита от посторонних запросов)
  // ---------------------------------------------------------------
  if (payload.verification_token !== KOFI_VERIFICATION_TOKEN) {
    console.warn("Invalid Ko-fi verification_token received");
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  // Игнорируем не-платёжные типы (например, обычный публичный донат без Tier)
  const relevantTypes = ["Subscription", "Shop Order", "Donation"];
  if (!relevantTypes.includes(payload.type)) {
    return jsonResponse({ message: "Ignored: unsupported type" }, 200);
  }

  const email = payload.email?.toLowerCase().trim();
  if (!email) {
    return jsonResponse({ error: "Missing buyer email" }, 400);
  }

  const plan = resolvePlan(payload);
  if (!plan) {
    console.warn("Could not resolve plan for payload:", payload.tier_name, payload.amount);
    return jsonResponse({ error: "Unrecognized tier/amount" }, 422);
  }

  // ---------------------------------------------------------------
  // 3. Supabase client с service_role — обходит RLS
  // ---------------------------------------------------------------
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Находим user_id по email через защищённую SECURITY DEFINER функцию
  // (auth.users не открыт напрямую через PostgREST — см. миграцию 0001)
  const { data: foundUserId, error: userError } = await supabase.rpc(
    "get_user_id_by_email",
    { p_email: email },
  );

  if (userError) {
    console.error("Error looking up user by email:", userError);
    return jsonResponse({ error: "Internal lookup error" }, 500);
  }

  if (!foundUserId) {
    // Платёж пришёл, но пользователь ещё не регистрировался в приложении —
    // сохраняем как pending заказ без user_id, чтобы не потерять данные.
    await supabase.from("orders").insert({
      user_id: null,
      email,
      amount: parseFloat(payload.amount),
      currency: payload.currency,
      plan_type: plan.plan_type,
      status: "pending",
      provider: "kofi",
      provider_txn_id: payload.kofi_transaction_id,
      raw_payload: payload,
    });
    console.warn(`No matching user for email ${email}; order stored as pending`);
    return jsonResponse({ message: "Order stored, awaiting user match" }, 200);
  }

  const userId = foundUserId as string;
  const periodEnd = new Date(Date.now() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // ---------------------------------------------------------------
  // 4. Идемпотентная запись заказа (upsert по provider_txn_id)
  // ---------------------------------------------------------------
  const { data: orderRow, error: orderError } = await supabase
    .from("orders")
    .upsert(
      {
        user_id: userId,
        email,
        amount: parseFloat(payload.amount),
        currency: payload.currency,
        plan_type: plan.plan_type,
        status: "success",
        provider: "kofi",
        provider_txn_id: payload.kofi_transaction_id,
        raw_payload: payload,
      },
      { onConflict: "provider,provider_txn_id" },
    )
    .select("id")
    .single();

  if (orderError) {
    console.error("Failed to upsert order:", orderError);
    return jsonResponse({ error: "Failed to record order" }, 500);
  }

  // ---------------------------------------------------------------
  // 5. Upsert подписки: активируем и продлеваем на +30 дней от текущего момента
  // ---------------------------------------------------------------
  const { error: subError } = await supabase.from("subscriptions").upsert(
    {
      user_id: userId,
      plan_type: plan.plan_type,
      access_status: "active",
      current_period_end: periodEnd,
      last_order_id: orderRow.id,
    },
    { onConflict: "user_id" },
  );

  if (subError) {
    console.error("Failed to upsert subscription:", subError);
    return jsonResponse({ error: "Failed to activate subscription" }, 500);
  }

  console.log(`Subscription activated for user ${userId}, plan=${plan.plan_type}, until=${periodEnd}`);
  return jsonResponse({ message: "Subscription activated" }, 200);
});