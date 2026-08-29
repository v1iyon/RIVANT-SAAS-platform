// app/api/webhooks/stripe/[businessId]/route.js
//
// ФІКС (аудит #2, знахідка №9 / перенесено з FINAL A4): "Stripe вебхук
// нічого не робить, метрики тільки на годинному кроні". Коментар у
// app/api/webhooks/stripe/route.ts (загальний, спільний вебхук — той
// файл лишається як заглушка для старих/задокументованих десь URL і
// нових підключень сюди більше не спрямовуємо) описував цей окремий,
// per-business роут як вже готовий фікс. Насправді файлу не існувало.
//
// Кожен бізнес отримує СВІЙ URL (/api/webhooks/stripe/{businessId}) і
// СВІЙ підписуючий секрет — це можливо, бо клієнти підключаються через
// restricted API key (не через єдиний Stripe Connect OAuth на всю
// платформу), і lib/stripe-webhook.mjs реєструє цей ендпоінт напряму в
// акаунті клієнта тим самим ключем під час підключення
// (app/api/connect-stripe/route.js).
//
// Важливо: цей роут навмисно НЕ намагається повторити повну логіку
// scripts/sync-stripe-core.mjs (gap-detection, Stripe fee, оцінка COGS,
// shopifyRevenueAuthoritative-гілку, rolling last24h/prev24h тощо) —
// саме дублювання формул по кількох місцях і було корнем находки №1
// цього ж аудиту ("маржа в кабінеті 95%, в телеграмі 0%"). Годинний
// крон лишається ЄДИНИМ джерелом правди й повністю ПЕРЕЗАПИСУЄ
// (upsert) рядок metrics_computed за цю дату з нуля при кожному прогоні
// — тому будь-яка неточність інкременту тут (наприклад, cost не
// перерахований під нову суму) сама виправиться протягом години.
// Завдання цього вебхука — тільки дати дашборду/боту відчуття "живих"
// цифр між прогонами, піднявши revenue/orders одразу після оплати.

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto";
import { getFullMarginForDay } from "@/lib/margin.js";
import { logError } from "@/lib/log-error";

export const runtime = "nodejs";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ФІКС (аудит #4): раніше тут було ["charge.succeeded",
// "payment_intent.succeeded"] — обидві події приходять на ОДНУ й ту саму
// успішну оплату майже одночасно, і кожна незалежно додавала revenueDelta
// нижче -> подвійний рахунок виручки в живому лічильнику до наступного
// годинного reconciliation. Лишаємо лише charge.succeeded. Список подій,
// на які клієнтський webhook endpoint реально підписаний у Stripe,
// заданий у lib/stripe-webhook.mjs (STRIPE_WEBHOOK_EVENTS) — тримати їх
// синхронізованими навмисно.
const RELEVANT_EVENTS = new Set(["charge.succeeded"]);

// Той самий підхід, що вже в sync-stripe-core.mjs/daily-reports.mjs/bot.js —
// "сьогодні" по ЛОКАЛЬНІЙ даті бізнесу, не по UTC і не по даті сервера.
function localDateStr(tz) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC" }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date());
  }
}

export async function POST(req, { params }) {
  const { businessId } = await params;

  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  // 1. Знаходимо секрет саме ЦЬОГО бізнесу — без цього неможливо
  // верифікувати підпис, а довіряти тілу запиту без верифікації не можна.
  const { data: integ, error: integErr } = await admin
    .from("integrations")
    .select("status, config")
    .eq("business_id", businessId)
    .eq("provider", "stripe")
    .maybeSingle();

  if (integErr) {
    console.error(`webhooks/stripe/${businessId}: failed to load integration:`, integErr.message);
    // 200, щоб Stripe не задовбав нескінченними ретраями через тимчасовий
    // збій БД — годинний крон однаково підхопить ці гроші пізніше.
    return Response.json({ received: true });
  }

  const secretEncrypted = integ?.config?.webhook_secret_encrypted;
  if (!secretEncrypted || integ.status !== "connected") {
    // Інтеграцію вже відключили (stripe-disconnect) або секрету ще/більше
    // немає — тихо ігноруємо, а не 400/500, інакше Stripe буде ретраїти
    // подію на "мертвий" бізнес нескінченно.
    return Response.json({ received: true });
  }

  let event;
  try {
    const webhookSecret = decrypt(secretEncrypted);
    // Клієнтський ключ тут не потрібен — constructEvent суто криптографічна
    // перевірка підпису локальним секретом, до Stripe API не звертається.
    const stripe = new Stripe("sk_not_used_for_signature_verification", {
      apiVersion: "2025-02-24.acacia",
    });
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error(`webhooks/stripe/${businessId}: signature verification failed:`, err.message);
    return Response.json({ error: "invalid signature" }, { status: 400 });
  }

  if (!RELEVANT_EVENTS.has(event.type)) {
    return Response.json({ received: true });
  }

  try {
    const obj = event.data.object;
    const amountCents = obj.amount ?? obj.amount_received ?? 0;
    const revenueDelta = Number((amountCents / 100).toFixed(2));
    if (!(revenueDelta > 0)) return Response.json({ received: true });

    const { data: business } = await admin
      .from("businesses")
      .select("id, timezone")
      .eq("id", businessId)
      .maybeSingle();
    if (!business) return Response.json({ received: true });

    // Якщо для цього бізнесу Shopify — авторитетне джерело revenue (той
    // самий режим, що враховує знахідка №2), Stripe тут виступає лише
    // платіжним процесором всередині Shopify Checkout — ці гроші вже
    // будуть пораховані через shopify-sync.mjs. Додавати їх ще й тут —
    // подвійний рахунок revenue.
    const { data: shopifyIntegration } = await admin
      .from("integrations")
      .select("status, last_synced_at, config")
      .eq("business_id", businessId)
      .eq("provider", "shopify")
      .maybeSingle();
    const shopifyConnected = shopifyIntegration?.status === "connected" && !!shopifyIntegration?.last_synced_at;
    const shopifyRevenueAuthoritative = shopifyConnected && shopifyIntegration?.config?.revenue_mode !== "add";
    if (shopifyRevenueAuthoritative) {
      return Response.json({ received: true });
    }

    const date = localDateStr(business.timezone);

    const { data: existing } = await admin
      .from("metrics_computed")
      .select("revenue, cost, orders")
      .eq("business_id", businessId)
      .eq("date", date)
      .maybeSingle();

    const newRevenue = Number(((existing?.revenue || 0) + revenueDelta).toFixed(2));
    const newOrders = (existing?.orders || 0) + 1;
    // cost навмисно НЕ перераховуємо тут (Stripe fee/COGS-оцінка) —
    // залишаємо, як був, до наступного годинного reconciliation-прогону.
    const baseCost = existing?.cost || 0;

    const { marginPct } = await getFullMarginForDay(businessId, date, newRevenue, baseCost);

    const { error: upsertErr } = await admin.from("metrics_computed").upsert(
      {
        business_id: businessId,
        date,
        revenue: newRevenue,
        cost: baseCost,
        margin_pct: marginPct,
        orders: newOrders,
      },
      { onConflict: "business_id,date" }
    );

    if (upsertErr) {
      console.error(`webhooks/stripe/${businessId}: failed to write incremental metrics_computed:`, upsertErr.message);
      await logError({
        source: "webhooks/stripe:incremental_update",
        message: upsertErr.message,
        details: { date, revenueDelta, eventType: event.type },
        businessId,
      });
    }
  } catch (err) {
    // Інкрементальне оновлення — best-effort прискорення UX, а не
    // джерело правди. Будь-яка помилка тут не повинна віддавати Stripe
    // не-200 (він почне ретраїти) — годинний крон однаково порахує
    // правильні цифри з нуля.
    console.error(`webhooks/stripe/${businessId}: incremental update failed:`, err.message);
  }

  return Response.json({ received: true });
}