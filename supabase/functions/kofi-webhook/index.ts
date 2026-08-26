// supabase/functions/kofi-webhook/index.ts
//
// Принимает POST от Ko-fi (application/x-www-form-urlencoded), проверяет
// verification_token, парсит JSON из поля `data`, находит пользователя по
// email в public.users и активирует подписку в public.subscriptions.
//
// ВАЖНО: эта функция НЕ трогает public.orders (та таблица заточена под
// крипто-чекаут: tx_hash/chain/token) — Ko-fi платежи в неё не пишутся.
//
// --------------------------------------------------------------------------
// v2: обработка ВСЕХ payload.shop_items, а не только shop_items[0].
//
// Причина: у Ko-fi корзина персистентная и невидимая для нашего сайта —
// если пользователь переходит по одной ссылке ("Order Service" / "Buy"),
// не завершает оплату, потом переходит по другой — второй товар
// добавляется в ТУ ЖЕ корзину. Это подтверждённое штатное поведение Ko-fi
// (см. скриншот реальной корзины: Starter Plan + AI Performance Digest x2
// в одном чеке), а не редкий edge case — значит вебхук обязан правильно
// обрабатывать любую комбинацию тариф+тариф / тариф+допуслуга /
// допуслуга+допуслуга(дубль) в одном payload.
//
// Deploy:
//   supabase functions deploy kofi-webhook --no-verify-jwt
//
// Secrets (уже установлен, см. предыдущий шаг):
//   supabase secrets set KOFI_VERIFICATION_TOKEN=xxxxx

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------
// Payload от Ko-fi (см. https://ko-fi.com/manage/webhooks)
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
  amount: string; // строка вида "299.00" — сумма ВСЕЙ корзины, не одного айтема
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

// Ko-fi Shop Item direct_link_code -> plan_id. Самый надёжный способ
// матчинга. Коды взяты из реальных ссылок:
//   Starter -> https://ko-fi.com/s/10eb6d89bf
//   Growth  -> https://ko-fi.com/s/9dcfdf1c5b
//   Scale   -> https://ko-fi.com/s/ed50f0bf6a
const DIRECT_LINK_CODE_TO_PLAN_ID: Record<string, string> = {
  "10eb6d89bf": "starter",
  "9dcfdf1c5b": "growth",
  "ed50f0bf6a": "premium",
};

// ---------------------------------------------------------------
// Допуслуги (addon-товары). Названия service_type/addon_type взяты 1-в-1
// из PRICE_TO_ADDON в app/api/webhooks/paddle/route.js.
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

// Только эти типы событий Ko-fi считаем платежом. "Donation" намеренно
// исключён: донат на произвольную сумму не должен ничего активировать
// просто потому, что сумма случайно совпала с ценой тарифа.
const PLAN_PAYMENT_TYPES: KofiPayload["type"][] = ["Subscription", "Shop Order"];

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Фоллбэк-резолв тарифа БЕЗ shop_items (Membership/Subscription-тип оплаты
// Ko-fi, а не Shop Order — там нет direct_link_code вообще, только
// tier_name/amount). Используется только если в payload.shop_items не
// нашлось ни одного тарифного айтема.
function resolvePlanWithoutShopItems(payload: KofiPayload): { plan_id: string; amount_cents: number } | null {
  if (payload.tier_name && TIER_TO_PLAN_ID[payload.tier_name]) {
    return TIER_TO_PLAN_ID[payload.tier_name];
  }
  const amountCents = Math.round(parseFloat(payload.amount) * 100);
  return Object.values(TIER_TO_PLAN_ID).find((t) => t.amount_cents === amountCents) ?? null;
}

// Безопасное (timing-safe) сравнение verification_token — тот же принцип,
// что уже применён в lib/verify-secret.js (ADMIN_SECRET/CRON_SECRET) и в
// polygon-webhook (подпись Alchemy). Обычное !== сравнивает посимвольно и
// выходит на первом несовпадении — по времени ответа теоретически можно
// подбирать токен посимвольно. См. п. A6 аудита.
function isValidKofiToken(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string" || !provided) return false;

  const providedBuf = new TextEncoder().encode(provided);
  const expectedBuf = new TextEncoder().encode(expected);

  if (providedBuf.length !== expectedBuf.length) {
    // timingSafeEqual требует буферы одинаковой длины и иначе бросает
    // исключение. Сравниваем expected сам с собой, чтобы не отвечать
    // быстрее на заведомо неверную длину (тоже временная утечка).
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }

  return timingSafeEqual(providedBuf, expectedBuf);
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
  if (!isValidKofiToken(payload.verification_token, KOFI_VERIFICATION_TOKEN)) {
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
  // 3. Идемпотентность НА УРОВНЕ ВСЕГО ЧЕКА: если этот kofi_transaction_id
  //    уже обработан — выходим. Это защита от ретраев Ko-fi (не получили
  //    200 вовремя — прислали тот же payload снова). Один kofi_transaction_id
  //    = один чек, каким бы ни было число товаров внутри — так что дедуп по
  //    всему payload остаётся корректным и после перехода на цикл по items.
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
      console.log(`Duplicate Ko-fi transaction ${payload.kofi_transaction_id}, skipping`);
      return jsonResponse({ message: "Already processed" }, 200);
    }
    console.error("Failed to log kofi transaction:", dedupeError);
    return jsonResponse({ error: "Internal error" }, 500);
  }

  async function logError(message: string, details: Record<string, unknown>) {
    await supabase.from("error_logs").insert({
      source: "kofi-webhook",
      message,
      details: JSON.stringify(details),
      resolved: false,
    });
  }

  // ---------------------------------------------------------------
  // 4. Находим пользователя по email — ОДИН раз на весь чек, а не по разу
  //    на тариф и на допуслугу, как было раньше.
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
    await logError("Ko-fi payment received but no matching user found", {
      email,
      kofi_transaction_id: payload.kofi_transaction_id,
      shop_items: payload.shop_items,
    });
    return jsonResponse({ message: "No matching user, logged for manual review" }, 200);
  }

  const userId = userRow.id as string;

  // ---------------------------------------------------------------
  // 5. Разбираем shop_items на тарифные и addon-айтемы. Дедуп по
  //    direct_link_code внутри самого чека — если один и тот же код
  //    встретился несколько раз (реальный кейс со скриншота: юзер дважды
  //    кликнул на Digest), активируем эффект ОДИН раз, но обязательно
  //    логируем это как потенциальную переплату — деньги за второй экземпляр
  //    ушли, а второй активации по смыслу может не быть (для monthly-addon
  //    активация и так идемпотентна через upsert; для разовой услуги
  //    дублировать генерацию отчёта без явного намерения юзера не стоит).
  // ---------------------------------------------------------------
  const planItems = new Map<string, { plan_id: string; totalQty: number }>();
  const addonItems = new Map<string, { mapping: AddonMapping; totalQty: number }>();
  const unresolvedItems: KofiShopItem[] = [];

  for (const item of payload.shop_items ?? []) {
    const code = item.direct_link_code;

    if (DIRECT_LINK_CODE_TO_ADDON[code]) {
      const existing = addonItems.get(code);
      addonItems.set(code, {
        mapping: DIRECT_LINK_CODE_TO_ADDON[code],
        totalQty: (existing?.totalQty ?? 0) + (item.quantity ?? 1),
      });
      continue;
    }

    if (DIRECT_LINK_CODE_TO_PLAN_ID[code]) {
      const existing = planItems.get(code);
      planItems.set(code, {
        plan_id: DIRECT_LINK_CODE_TO_PLAN_ID[code],
        totalQty: (existing?.totalQty ?? 0) + (item.quantity ?? 1),
      });
      continue;
    }

    unresolvedItems.push(item);
  }

  if (unresolvedItems.length > 0) {
    await logError("Ko-fi shop items with unrecognized direct_link_code", {
      email,
      kofi_transaction_id: payload.kofi_transaction_id,
      unresolved: unresolvedItems,
    });
  }

  const results: Record<string, unknown>[] = [];

  // ---------------------------------------------------------------
  // 6. Тариф(ы). Политика при нескольких РАЗНЫХ тарифов в одной корзине —
  //    редкий, но возможный кейс (юзер передумал и добавил другой тариф не
  //    убрав старый) — активируем самый дорогой (наибольший amount_cents):
  //    это безопаснее с точки зрения "не занизить то, за что заплатили",
  //    и в любом случае логируем для ручной проверки, потому что тут явно
  //    нужно решение по возврату за лишний тариф.
  // ---------------------------------------------------------------
  let resolvedPlan: { plan_id: string; amount_cents: number } | null = null;

  if (planItems.size > 0) {
    const candidates = [...planItems.values()].map((p) => ({
      plan_id: p.plan_id,
      amount_cents: Object.values(TIER_TO_PLAN_ID).find((t) => t.plan_id === p.plan_id)?.amount_cents ?? 0,
    }));
    resolvedPlan = candidates.reduce((a, b) => (b.amount_cents > a.amount_cents ? b : a));

    if (planItems.size > 1) {
      await logError("Ko-fi checkout contained multiple different plans", {
        email,
        kofi_transaction_id: payload.kofi_transaction_id,
        plans_in_cart: candidates,
        activated: resolvedPlan.plan_id,
      });
    }
  } else {
    // Shop Order без распознанных plan-кодов в items — может быть чистый
    // Subscription/Membership пуш без shop_items вообще.
    resolvedPlan = resolvePlanWithoutShopItems(payload);
  }

  if (resolvedPlan) {
    const periodEnd = new Date(Date.now() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    const { error: subError } = await supabase.from("subscriptions").upsert(
      {
        user_id: userId,
        plan_id: resolvedPlan.plan_id,
        access_status: "active",
        current_period_end: periodEnd,
        updated_at: now,
      },
      { onConflict: "user_id" },
    );

    if (subError) {
      console.error("Failed to upsert subscription:", subError);
      await logError("Failed to activate subscription from Ko-fi payment", {
        user_id: userId,
        plan_id: resolvedPlan.plan_id,
        error: subError.message,
      });
      results.push({ type: "plan", plan_id: resolvedPlan.plan_id, status: "error" });
    } else {
      console.log(`Subscription activated: user=${userId}, plan=${resolvedPlan.plan_id}, until=${periodEnd}`);
      results.push({ type: "plan", plan_id: resolvedPlan.plan_id, status: "activated" });
    }
  }

  // public.users.has_active_subscription сознательно не трогаем — см. п.7
  // из предыдущей версии файла, ничего не изменилось в этом решении.

  // ---------------------------------------------------------------
  // 7. Допуслуги. business_id резолвим ОДИН раз, лениво — только если
  //    в чеке реально есть addon-айтемы, тарифам он не нужен.
  // ---------------------------------------------------------------
  if (addonItems.size > 0) {
    const { data: userBusinesses, error: businessesError } = await supabase
      .from("businesses")
      .select("id")
      .eq("user_id", userId);

    if (businessesError) {
      console.error("Error looking up businesses for addon:", businessesError);
      results.push({ type: "addon", status: "error", reason: "business_lookup_failed" });
    } else if (!userBusinesses || userBusinesses.length !== 1) {
      console.warn(`Ambiguous business_id: user=${userId}, count=${userBusinesses?.length ?? 0}`);
      await logError("Ko-fi addon payment: could not resolve a single business_id for user", {
        user_id: userId,
        business_count: userBusinesses?.length ?? 0,
        addons: [...addonItems.values()].map((a) => a.mapping),
        kofi_transaction_id: payload.kofi_transaction_id,
      });
      results.push({ type: "addon", status: "logged_ambiguous_business" });
    } else {
      const businessId = userBusinesses[0].id as string;

      for (const [code, { mapping, totalQty }] of addonItems) {
        if (totalQty > 1) {
          // Юзер заплатил за N экземпляров одной и той же допуслуги в одном
          // чеке (кейс со скриншота). Активируем эффект один раз и явно
          // логируем переплату — это НЕ технический сбой, а вопрос
          // частичного возврата, который решает человек, а не код.
          await logError("Ko-fi checkout contained duplicate addon quantity — possible overcharge", {
            user_id: userId,
            business_id: businessId,
            addon: mapping,
            direct_link_code: code,
            quantity_paid: totalQty,
            kofi_transaction_id: payload.kofi_transaction_id,
          });
        }

        try {
          if (mapping.kind === "order") {
            const { error: orderError } = await supabase.from("service_orders").insert({
              business_id: businessId,
              user_id: userId,
              service_type: mapping.service_type,
              status: "pending",
            });
            if (orderError) throw orderError;
            results.push({ type: "addon_order", service_type: mapping.service_type, status: "created" });
          } else {
            const addonPeriodEnd = new Date(Date.now() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
            const { error: addonSubError } = await supabase.from("addon_subscriptions").upsert(
              {
                business_id: businessId,
                addon_type: mapping.addon_type,
                status: "active",
                current_period_end: addonPeriodEnd,
              },
              { onConflict: "business_id,addon_type" },
            );
            if (addonSubError) throw addonSubError;
            results.push({ type: "addon_subscription", addon_type: mapping.addon_type, status: "activated" });
          }
        } catch (err) {
          // Один упавший addon не должен блокировать остальные айтемы чека —
          // именно поэтому try/catch внутри цикла, а не вокруг всей функции.
          console.error(`Failed to process addon ${code}:`, err);
          await logError("Failed to process Ko-fi addon item", {
            user_id: userId,
            business_id: businessId,
            addon: mapping,
            direct_link_code: code,
            error: (err as Error).message,
          });
          results.push({ type: "addon", direct_link_code: code, status: "error" });
        }
      }
    }
  }

  if (results.length === 0) {
    console.warn("Could not resolve any plan/addon for Ko-fi payment", payload.kofi_transaction_id);
    await logError("Unrecognized Ko-fi payment: no plan or addon resolved", {
      email,
      tier_name: payload.tier_name,
      amount: payload.amount,
      shop_items: payload.shop_items,
      kofi_transaction_id: payload.kofi_transaction_id,
    });
    return jsonResponse({ error: "Unrecognized payment content" }, 422);
  }

  return jsonResponse({ message: "Processed", results }, 200);
});