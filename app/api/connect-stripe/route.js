// app/api/connect-stripe/route.js
import { createClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/crypto";
import { requireUser, UnauthorizedError } from "@/lib/require-user";

export const runtime = "nodejs";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Плани, які отримують усі провайдери без явного вибору слоту (Scale
// платить саме за "усі інтеграції одразу", Trial має реально дати
// спробувати все — інакше плашка "усі інтеграції безкоштовно" на лендингу
// була б неправдою). Для решти планів (starter/growth) провайдер повинен
// бути в integrations_selected — це і є той самий слот, який клієнт обрав
// через /api/integrations-select.
const UNLIMITED_PLANS = ["scale", "trial"];

async function verifyStripeKey(apiKey) {
  const res = await fetch("https://api.stripe.com/v1/charges?limit=1", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return res.ok;
}

export async function POST(req) {
  try {
    const { apiKey } = await req.json();
    const { email } = await requireUser();

    if (!apiKey) {
      return Response.json({ error: "API key is required" }, { status: 400 });
    }

    if (!apiKey.startsWith("rk_")) {
      return Response.json(
        { error: "Please use a restricted key (starts with rk_test_ or rk_live_), not a full secret key" },
        { status: 400 }
      );
    }

    // ФІКС (аудит 30.08.2026, знахідка №1): раніше приймався БУДЬ-ЯКИЙ
    // restricted-ключ, тестовий чи бойовий, без жодної різниці. Наслідок:
    // scripts/sync-stripe-core.mjs тягне /v1/charges цим самим ключем і
    // сумує все, що Stripe повертає, — для тестового ключа це тестові
    // charges (створені під час розробки/тестування чекауту), і вони 1-в-1
    // потрапляють у metrics_computed як справжня виручка, з бейджем
    // "Наживо" на дашборді, без жодного попередження. Реальний клієнт, який
    // переплутає test/live ключ (Stripe навмисно робить їх максимально
    // схожими — відрізняється лише це слово в префіксі), побачить точно ту
    // ж фейкову картину.
    //
    // Формат restricted-ключа сам містить режим у префіксі
    // (rk_live_... / rk_test_...) — Stripe API-виклик для цього не
    // потрібен. Продакшн приймає лише live-ключі; тестові — з чіткою
    // помилкою, а не мовчки.
    if (!apiKey.startsWith("rk_live_")) {
      return Response.json(
        {
          error: "test_key_not_allowed",
          message:
            "Це тестовий ключ Stripe (rk_test_...). Підключіть бойовий ключ (rk_live_...), щоб бачити реальну виручку.",
        },
        { status: 400 }
      );
    }

    const { data: user } = await admin
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (!user) {
      return Response.json({ error: "Account not found" }, { status: 404 });
    }

    // ВАЖЛИВО (фікс під нову тарифну логіку — Stripe і Shopify тепер
    // рівноправні джерела виручки, кожне займає слот інтеграції): раніше
    // тут не було жодної перевірки плану/слотів — Stripe підключався
    // будь-кому з бізнес-профілем незалежно від тарифу чи вибору,
    // зробленого через /api/integrations-select. Клієнт на Starter, який
    // обрав Shopify єдиним джерелом виручки, міг би все одно підключити
    // Stripe в обхід вибраного слота (наприклад, прямим запитом до цього
    // ендпоінта, минаючи UI). Тепер для планів з обмеженою кількістю
    // слотів (starter/growth) Stripe можна підключити, тільки якщо він є
    // в integrations_selected — тобто клієнт свідомо обрав саме цей слот.
    const { data: sub } = await admin
      .from("subscriptions")
      .select("plan, integrations_selected")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!sub) {
      return Response.json({ error: "No active subscription" }, { status: 403 });
    }

    if (!UNLIMITED_PLANS.includes(sub.plan)) {
      const selected = sub.integrations_selected || [];
      if (!selected.includes("stripe")) {
        return Response.json(
          {
            error: "stripe_not_selected",
            message: "Оберіть Stripe як джерело виручки в налаштуваннях інтеграцій перед підключенням",
          },
          { status: 403 }
        );
      }
    }

    const isValid = await verifyStripeKey(apiKey);
    if (!isValid) {
      return Response.json(
        { error: "Stripe rejected this key. Check it has 'Charges: Read' permission and is not expired." },
        { status: 400 }
      );
    }

    const { data: business } = await admin
      .from("businesses")
      .select("id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!business) {
      return Response.json(
        { error: "Complete your business profile first (Settings → Company Name)" },
        { status: 400 }
      );
    }

    const encrypted = encrypt(apiKey);
    const keyPreview = apiKey.slice(0, 12) + "..." + apiKey.slice(-4);

    // ФІКС (аудит #2, знахідка №9): пробуємо одразу зареєструвати
    // per-business webhook endpoint у Stripe-акаунті клієнта тим самим
    // restricted key — щоб метрики оновлювались майже одразу після оплати,
    // а не чекали до годинного крону. Best-effort: якщо у ключа нема права
    // "Webhook Endpoints: Write" (клієнт видав вужчий ключ) — просто
    // лишаємось на кроні, як і раніше, нічого не ламаємо і не блокуємо
    // підключення через це.
    const { ensureStripeWebhook } = await import("../../../lib/stripe-webhook.mjs");
    const webhook = await ensureStripeWebhook(apiKey, business.id, encrypt);
    const config = {
      backfill_pending: true,
      ...(webhook ? { webhook_id: webhook.id, webhook_secret_encrypted: webhook.secretEncrypted } : {}),
    };

    const { data: existing } = await admin
      .from("integrations")
      .select("id")
      .eq("business_id", business.id)
      .eq("provider", "stripe")
      .maybeSingle();

    if (existing) {
      await admin
        .from("integrations")
        .update({ api_key_encrypted: encrypted, status: "connected", key_preview: keyPreview, config })
        .eq("id", existing.id);
    } else {
      await admin.from("integrations").insert({
        business_id: business.id,
        provider: "stripe",
        api_key_encrypted: encrypted,
        status: "connected",
        key_preview: keyPreview,
        config,
      });
    }

    return Response.json({ success: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    console.error("connect-stripe error:", err);
    return Response.json({ error: "Server error, try again" }, { status: 500 });
  }
}