// app/api/integrations-select/route.js
//
// ОНОВЛЕНО під нову тарифну логіку (Стартер $99 / Зростання $299 / Масштаб
// $499 — див. обговорення тарифів). РАНІШЕ Stripe вважався обов'язковим і
// підключався поза цим ендпоінтом (окремий /api/connect-stripe), а тут
// обирались тільки ДОДАТКОВІ інтеграції понад нього — Growth міг обрати
// рівно 1 (Shopify/Meta Ads/Google Ads), Scale отримував усе без вибору.
//
// Проблема цього підходу: клієнт, чия виручка йде через Shopify Payments
// (а не Stripe), був змушений підключати Stripe, якого в нього фізично
// немає — продукт для нього просто не працював на жодному тарифі.
//
// Тепер Stripe і Shopify — РІВНОПРАВНІ ДЖЕРЕЛА ВИРУЧКИ. Клієнт сам обирає,
// яке з них (або обидва) використовувати, і це витрачає такий самий слот
// інтеграції, як Meta Ads чи Google Ads:
//   - Starter (1 слот)  — Stripe АБО Shopify. Без додаткових інтеграцій.
//   - Growth (2 слоти)  — будь-яка комбінація з чотирьох (Stripe, Shopify,
//                          Meta Ads, Google Ads), мінімум 1 слот — джерело
//                          виручки (інакше рахувати нема з чим: CAC,
//                          revenue_drop, щоденні звіти — усе рахується від
//                          виручки, яку пише тільки stripe-sync/shopify-sync).
//   - Scale/Trial       — без обмеження кількості слотів.
import { createClient } from "@supabase/supabase-js";
import { requireUser, UnauthorizedError } from "@/lib/require-user";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// "stripe" тепер теж у списку вибору (раніше був мовчазним дефолтом поза
// цим ендпоінтом) — саме тому, що тепер є альтернатива (Shopify), вибір
// джерела виручки має бути явним, а не зашитим.
const SELECTABLE_PROVIDERS = ["stripe", "shopify", "woocommerce", "paypal", "meta_ads", "google_ads", "quickbooks", "google_analytics"];

// Джерела виручки — без ЖОДНОГО з них продукт не працює: немає виручки —
// немає маржі, revenue_drop, CAC, щоденних звітів (усе це рахується від
// metrics_computed, яку заповнюють тільки stripe-sync, shopify-sync,
// woocommerce-sync і paypal-sync). WooCommerce додано на тих самих правах,
// що й Shopify — це теж самостійний storefront, а не рекламний канал, тож
// теж вважається джерелом виручки. paypal доданий 03.09.2026 — lib/plan-slots.js
// має той самий масив (єдиний "офіційний" список), цей файл історично тримає
// власну копію замість імпорту звідти; зміна тут зроблена в парі зі зміною там.
// Тому будь-який НЕпорожній вибір повинен містити щонайменше одне з чотирьох.
const REVENUE_SOURCE_PROVIDERS = ["stripe", "shopify", "woocommerce", "paypal"];

// Кількість слотів інтеграцій за планом.
const PLAN_SLOTS = {
  starter: 1,
  growth: 2,
  scale: Infinity,
  trial: Infinity, // трiал має реально дати спробувати все — інакше плашка
  // "усі інтеграції безкоштовно" на лендингу була б неправдою.
};

// Спільна валідація для POST — винесена окремо, щоб її можна було
// одноразово покрити тестами і не дублювати логіку "скільки слотів і чи є
// серед них джерело виручки" у двох місцях.
function validateSelection(plan, providers) {
  const maxSlots = PLAN_SLOTS[plan];
  if (maxSlots === undefined) {
    return "Additional integrations require an active plan";
  }
  if (providers.length > maxSlots) {
    return maxSlots === Infinity
      ? "Invalid selection"
      : `The ${plan} plan allows up to ${maxSlots} integration(s)`;
  }
  // Порожній вибір дозволений (клієнт ще нічого не підключив або свідомо
  // скинув вибір) — вимога "мінімум 1 джерело виручки" стосується тільки
  // НЕпорожнього вибору.
  if (providers.length > 0 && !providers.some((p) => REVENUE_SOURCE_PROVIDERS.includes(p))) {
    return "Selection must include at least one revenue source (Stripe, Shopify, WooCommerce or PayPal)";
  }
  return null;
}

export async function GET(req) {
  let email;
  try {
    ({ email } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }

  const { data: user } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!user) return Response.json({ selected: [], locked: false });

  const { data: sub } = await admin
    .from("subscriptions")
    .select("plan, integrations_selected, current_period_end")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!sub) return Response.json({ selected: [], locked: false });

  const periodActive = sub.current_period_end ? new Date(sub.current_period_end) > new Date() : false;
  const selected = sub.integrations_selected || [];
  const maxSlots = PLAN_SLOTS[sub.plan];

  return Response.json({
    selected,
    // Заблокировано менять выбор, если план Growth (не Scale), выбор уже не пуст
    // и текущий billing-период ещё не закончился. Такое саме правило лишається
    // для Starter — 1 слот теж "фіксується" на період, щоб не можна було
    // щодня перескакувати між Stripe/Shopify без апгрейду.
    locked: (sub.plan === "growth" || sub.plan === "starter") && selected.length > 0 && periodActive,
    plan: sub.plan,
    maxSlots: maxSlots === undefined ? 0 : maxSlots === Infinity ? null : maxSlots,
  });
}

export async function POST(req) {
  try {
    const { providers } = await req.json();
    const { email } = await requireUser();
    if (!Array.isArray(providers)) {
      return Response.json({ error: "providers[] is required" }, { status: 400 });
    }
    if (providers.some((p) => !SELECTABLE_PROVIDERS.includes(p))) {
      return Response.json({ error: "Unknown provider in selection" }, { status: 400 });
    }
    // Дубликаты в теле запроса не должны тратить два слота на один и тот
    // же provider (например ["stripe","stripe"] не должно проходить как
    // "заняты оба слота Growth").
    const uniqueProviders = [...new Set(providers)];

    const { data: user } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    if (!user) return Response.json({ error: "User not found" }, { status: 404 });

    const { data: sub } = await admin
      .from("subscriptions")
      .select("plan, integrations_selected, current_period_end")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!sub) return Response.json({ error: "No active subscription" }, { status: 400 });

    const periodActive = sub.current_period_end ? new Date(sub.current_period_end) > new Date() : false;
    // Той самий "locked" принцип, що і в GET — тепер стосується і Starter,
    // бо там теж є реальний вибір (Stripe vs Shopify), а не автоматичний
    // Stripe за замовчуванням.
    const alreadyLocked =
      (sub.plan === "growth" || sub.plan === "starter") &&
      (sub.integrations_selected || []).length > 0 &&
      periodActive;
    if (alreadyLocked) {
      return Response.json(
        { error: "Selection is locked until your current billing period ends or you upgrade your plan" },
        { status: 403 }
      );
    }

    const validationError = validateSelection(sub.plan, uniqueProviders);
    if (validationError) {
      return Response.json({ error: validationError }, { status: 400 });
    }

    await admin.from("subscriptions").update({ integrations_selected: uniqueProviders }).eq("user_id", user.id);

    return Response.json({ success: true, selected: uniqueProviders });
  } catch (err) {
    if (err instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    console.error("integrations-select error:", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}

export { SELECTABLE_PROVIDERS, REVENUE_SOURCE_PROVIDERS, PLAN_SLOTS };