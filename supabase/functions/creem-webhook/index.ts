// supabase/functions/creem-webhook/index.ts
//
// Заменяет supabase/functions/kofi-webhook. Обрабатывает вебхуки Creem
// (Merchant of Record) для тарифов (Starter/Growth/Scale) и recurring/
// one-time допуслуг (whatif_analysis/monthly_digest/team_alerts).
// Крипто-оплата (polygon-webhook) не трогается.
//
// Ключевое отличие от Ko-fi: у Creem нет персистентной невидимой
// корзины — каждый checkout session создаётся сервером (см.
// creem-checkout/index.ts) с metadata { kind, plan_id | addon_slug,
// addon_kind, user_id, business_id }, которую Creem возвращает нам назад
// в событии как есть. Поэтому весь блок kofi-webhook, посвящённый разбору
// payload.shop_items (несколько разных тарифов/допуслуг в одном чеке,
// дедуп кода товара внутри чека и т.д.), здесь не нужен — один checkout
// = один продукт, resolvedPlan/resolvedAddon всегда однозначны.
//
// Deploy:
//   supabase functions deploy creem-webhook --no-verify-jwt
//
// Secrets:
//   supabase secrets set CREEM_WEBHOOK_SECRET=whsec_xxx
// (CREEM_API_KEY/CREEM_MODE не нужны здесь — вебхук ничего не вызывает
// обратно в Creem, только читает то, что Creem прислал.)
//
// Регистрация URL: Creem Dashboard -> Developers -> Webhooks -> добавить
// https://<project>.supabase.co/functions/v1/creem-webhook, включить
// события: checkout.completed, subscription.paid, subscription.canceled,
// subscription.expired, refund.created, dispute.created.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { timingSafeEqual } from "node:crypto";
import { createHmac } from "node:crypto";

interface CreemEvent {
  id: string;
  eventType: string;
  created_at: number;
  object: Record<string, any>;
}

const SUBSCRIPTION_DAYS = 30; // фоллбэк, если Creem не прислал current_period_end_date

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Тот же timing-safe принцип, что и в kofi-webhook/polygon-webhook —
// сравнение подписи не должно быть в духе obj === obj посимвольно.
function isValidSignature(rawBody: string, providedHex: string | null, secret: string): boolean {
  if (!providedHex) return false;

  const computedHex = createHmac("sha256", secret).update(rawBody).digest("hex");

  let providedBuf: Buffer, computedBuf: Buffer;
  try {
    providedBuf = Buffer.from(providedHex, "hex");
    computedBuf = Buffer.from(computedHex, "hex");
  } catch {
    return false;
  }
  if (providedBuf.length !== computedBuf.length) {
    timingSafeEqual(computedBuf, computedBuf);
    return false;
  }
  return timingSafeEqual(providedBuf, computedBuf);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const CREEM_WEBHOOK_SECRET = Deno.env.get("CREEM_WEBHOOK_SECRET");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!CREEM_WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing required environment secrets");
    return jsonResponse({ error: "Server misconfiguration" }, 500);
  }

  const rawBody = await req.text();
  const signature = req.headers.get("creem-signature");

  if (!isValidSignature(rawBody, signature, CREEM_WEBHOOK_SECRET)) {
    console.warn("Invalid Creem signature received");
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let event: CreemEvent;
  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    console.error("Failed to parse Creem webhook body:", err);
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // --- Идемпотентность по event.id — Creem ретраит недоставленные
  // вебхуки с backoff 30s/1m/5m/1h, присылая тот же event.id снова. ---
  const { error: dedupeError } = await supabase.from("creem_events").insert({
    event_id: event.id,
    event_type: event.eventType,
    email: event.object?.customer?.email ?? null,
    raw_payload: event,
  });

  if (dedupeError) {
    if (dedupeError.code === "23505") {
      console.log(`Duplicate Creem event ${event.id}, skipping`);
      return jsonResponse({ message: "Already processed" }, 200);
    }
    console.error("Failed to log creem event:", dedupeError);
    return jsonResponse({ error: "Internal error" }, 500);
  }

  async function notifyOwnerTelegram(text: string) {
    const token = Deno.env.get("BOT_TOKEN");
    const chatId = Deno.env.get("ADMIN_TELEGRAM_CHAT_ID");
    if (!token || !chatId) return;
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
      });
    } catch (e) {
      console.error("Failed to send owner Telegram alert:", e instanceof Error ? e.message : e);
    }
  }

  async function logError(message: string, details: Record<string, unknown>, critical = false) {
    await supabase.from("error_logs").insert({
      source: "creem-webhook",
      message,
      details: JSON.stringify(details),
      resolved: false,
    });
    if (critical) {
      await notifyOwnerTelegram(`🔴 <b>Creem payment event failed to apply</b>\n${message}\n\n${JSON.stringify(details).slice(0, 500)}`);
    }
  }

  // ---------------------------------------------------------------
  // checkout.completed — первичная активация (см. checkout metadata из
  // creem-checkout/index.ts: kind, plan_id | addon_slug + addon_kind,
  // user_id, business_id).
  // ---------------------------------------------------------------
  async function handleCheckoutCompleted(obj: Record<string, any>) {
    const metadata = obj.metadata ?? {};
    const userId = metadata.user_id;
    const providerSubscriptionId: string | null = obj.subscription?.id ?? null;

    if (!userId) {
      await logError("Creem checkout.completed missing metadata.user_id", { checkout_id: obj.id, metadata }, true);
      return { type: "unknown", status: "error" };
    }

    if (metadata.kind === "plan") {
      const planId = metadata.plan_id;
      if (!planId) {
        await logError("Creem checkout.completed (plan) missing metadata.plan_id", { checkout_id: obj.id, metadata }, true);
        return { type: "plan", status: "error" };
      }

      const periodEnd = new Date(Date.now() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { error: subError } = await supabase.from("subscriptions").upsert(
        {
          user_id: userId,
          plan: planId,
          access_status: "active",
          current_period_end: periodEnd,
          provider_subscription_id: providerSubscriptionId,
        },
        { onConflict: "user_id" },
      );

      if (subError) {
        console.error("Failed to upsert subscription:", subError);
        await logError("Failed to activate subscription from Creem payment", { user_id: userId, plan_id: planId, error: subError.message }, true);
        return { type: "plan", plan_id: planId, status: "error" };
      }

      console.log(`Subscription activated: user=${userId}, plan=${planId}, until=${periodEnd}`);
      return { type: "plan", plan_id: planId, status: "activated" };
    }

    if (metadata.kind === "addon") {
      const addonSlug = metadata.addon_slug;
      const businessId = metadata.business_id;

      if (!addonSlug || !businessId) {
        await logError("Creem checkout.completed (addon) missing metadata", { checkout_id: obj.id, metadata }, true);
        return { type: "addon", status: "error" };
      }

      if (metadata.addon_kind === "order") {
        const { error: orderError } = await supabase.from("service_orders").insert({
          business_id: businessId,
          user_id: userId,
          service_type: addonSlug,
          status: "pending",
        });
        if (orderError) {
          console.error("Failed to create service_order:", orderError);
          await logError("Failed to create service_order from Creem payment", { business_id: businessId, addon_slug: addonSlug, error: orderError.message }, true);
          return { type: "addon_order", service_type: addonSlug, status: "error" };
        }
        return { type: "addon_order", service_type: addonSlug, status: "created" };
      }

      // addon_kind === "subscription"
      const periodEnd = new Date(Date.now() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { error: addonSubError } = await supabase.from("addon_subscriptions").upsert(
        {
          business_id: businessId,
          addon_type: addonSlug,
          status: "active",
          current_period_end: periodEnd,
          creem_subscription_id: providerSubscriptionId,
        },
        { onConflict: "business_id,addon_type" },
      );
      if (addonSubError) {
        console.error("Failed to upsert addon_subscription:", addonSubError);
        await logError("Failed to activate addon_subscription from Creem payment", { business_id: businessId, addon_slug: addonSlug, error: addonSubError.message }, true);
        return { type: "addon_subscription", addon_type: addonSlug, status: "error" };
      }
      return { type: "addon_subscription", addon_type: addonSlug, status: "activated" };
    }

    await logError("Creem checkout.completed with unrecognized metadata.kind", { checkout_id: obj.id, metadata }, true);
    return { type: "unknown", status: "error" };
  }

  // ---------------------------------------------------------------
  // subscription.paid — продление (renewal) уже активной подписки.
  // Матчим по provider id в первую очередь (надёжнее при гонках), с
  // фоллбэком на metadata, если по какой-то причине id ещё не записан
  // (например, checkout.completed и первый subscription.paid пришли
  // почти одновременно и порядок доставки не гарантирован).
  // ---------------------------------------------------------------
  async function handleSubscriptionPaid(obj: Record<string, any>) {
    const metadata = obj.metadata ?? {};
    const subId = obj.id as string;
    const periodEnd = obj.current_period_end_date ?? new Date(Date.now() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    if (metadata.kind === "plan" || (!metadata.kind && metadata.plan_id)) {
      const query = supabase.from("subscriptions").update({ access_status: "active", current_period_end: periodEnd, provider_subscription_id: subId });
      const { error } = metadata.user_id
        ? await query.eq("user_id", metadata.user_id)
        : await query.eq("provider_subscription_id", subId);

      if (error) {
        await logError("Failed to renew subscription from Creem subscription.paid", { subscription_id: subId, metadata, error: error.message }, true);
        return { type: "plan_renewal", status: "error" };
      }
      return { type: "plan_renewal", status: "renewed" };
    }

    if (metadata.kind === "addon" || metadata.addon_slug) {
      const query = supabase.from("addon_subscriptions").update({ status: "active", current_period_end: periodEnd, creem_subscription_id: subId });
      const { error } = metadata.business_id && metadata.addon_slug
        ? await query.eq("business_id", metadata.business_id).eq("addon_type", metadata.addon_slug)
        : await query.eq("creem_subscription_id", subId);

      if (error) {
        await logError("Failed to renew addon_subscription from Creem subscription.paid", { subscription_id: subId, metadata, error: error.message }, true);
        return { type: "addon_renewal", status: "error" };
      }
      return { type: "addon_renewal", status: "renewed" };
    }

    // Первый платёж по подписке иногда приходит как subscription.paid
    // раньше/без явной связки с нашими metadata (edge case) — просто
    // логируем для ручной проверки вместо падения.
    await logError("Creem subscription.paid could not be matched to a plan or addon", { subscription_id: subId, metadata });
    return { type: "unknown_renewal", status: "logged" };
  }

  // ---------------------------------------------------------------
  // subscription.canceled / subscription.expired / refund.created /
  // dispute.created — во всех случаях закрываем доступ. Тот же принцип,
  // что уже в app/api/webhooks/paddle/route.js: access_status: "blocked"
  // для тарифов (не трогаем current_period_end/plan), status: "expired"
  // для допуслуг.
  // ---------------------------------------------------------------
  async function revokeAccess(obj: Record<string, any>, reason: string) {
    const metadata = obj.metadata ?? {};
    const subId = (obj.id as string) ?? obj.subscription?.id;

    if (metadata.kind === "plan" || metadata.plan_id) {
      const query = supabase.from("subscriptions").update({ access_status: "blocked" });
      const { error } = metadata.user_id
        ? await query.eq("user_id", metadata.user_id)
        : await query.eq("provider_subscription_id", subId);
      if (error) await logError(`Failed to revoke plan access (${reason})`, { subscription_id: subId, metadata, error: error.message }, true);
      return { type: "plan_revoke", status: error ? "error" : "blocked" };
    }

    if (metadata.kind === "addon" || metadata.addon_slug) {
      const query = supabase.from("addon_subscriptions").update({ status: "expired" });
      const { error } = metadata.business_id && metadata.addon_slug
        ? await query.eq("business_id", metadata.business_id).eq("addon_type", metadata.addon_slug)
        : await query.eq("creem_subscription_id", subId);
      if (error) await logError(`Failed to revoke addon access (${reason})`, { subscription_id: subId, metadata, error: error.message }, true);
      return { type: "addon_revoke", status: error ? "error" : "expired" };
    }

    await logError(`Creem ${reason} could not be matched to a plan or addon`, { subscription_id: subId, metadata });
    return { type: "unknown_revoke", status: "logged" };
  }

  let result: Record<string, unknown>;

  switch (event.eventType) {
    case "checkout.completed":
      result = await handleCheckoutCompleted(event.object);
      break;
    case "subscription.paid":
      result = await handleSubscriptionPaid(event.object);
      break;
    case "subscription.canceled":
    case "subscription.expired":
      result = await revokeAccess(event.object, event.eventType);
      break;
    case "refund.created":
      // refund.created приходит с object.subscription (не полная метадата) —
      // достаточно для матчинга по id, metadata тут может отсутствовать.
      result = await revokeAccess(
        { id: event.object.subscription?.id, metadata: event.object.subscription ?? {} },
        "refund.created",
      );
      await logError("Creem refund issued — access revoked, review for partial-refund edge cases", { event }, true);
      break;
    case "dispute.created":
      await logError("Creem dispute opened — needs manual review", { event }, true);
      result = { type: "dispute", status: "logged" };
      break;
    default:
      console.log(`Unhandled Creem event type: ${event.eventType}`);
      result = { type: "ignored", status: "unhandled_event_type" };
  }

  return jsonResponse({ message: "Processed", result }, 200);
});