// app/api/connect-integration/route.js
import { createClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/crypto";
import { requireUser, UnauthorizedError } from "@/lib/require-user";
import { normalizeStoreUrl, assertPublicHostname } from "@/lib/woocommerce-url";
import { REPLACE_TOGGLE_PROVIDERS, effectiveRevenueMode, downgradeConflictingReplaceProviders } from "@/lib/revenue-mode";

export const runtime = "nodejs";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SUPPORTED_PROVIDERS = ["meta_ads", "google_ads", "shopify", "woocommerce", "quickbooks", "google_analytics", "paypal"];

// Той самий принцип, що і в app/api/connect-stripe/route.js: Scale/Trial
// отримують усе без явного вибору слоту, решта планів (starter/growth)
// повинні мати провайдера в integrations_selected (обраного через
// /api/integrations-select) ПЕРЕД тим, як його реально можна підключити
// ключем. Раніше цей роут не дивився на план/слоти взагалі — будь-який
// залогінений юзер із бізнес-профілем міг підключити будь-яку кількість
// Shopify/Meta Ads/Google Ads незалежно від тарифу, в обхід вибраного
// на /api/integrations-select слоту.
const UNLIMITED_PLANS = ["scale", "trial"];

// Простая проверка "непустой строки разумной длины" — реальная проверка валидности
// ключа у каждого провайдера своя (Этап 3, sync-модули), сюда её добавим позже.
function looksLikeAKey(value) {
  return typeof value === "string" && value.trim().length >= 8;
}

// ФІКС (аудит #2, знахідка №5 — SSRF, друга лінія захисту): та сама
// перевірка, що й normalizeShopDomain у scripts/shopify-sync.mjs — тепер
// невалідний shop_domain (довільний зовнішній домен або IP, напр.
// cloud-metadata "169.254.169.254") відхиляється тут же, при збереженні,
// 400-кою, а не тільки мовчки під час наступного синку.
function isValidShopifyDomain(raw) {
  let domain = (raw || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!domain) return false;
  if (!domain.includes(".")) domain = `${domain}.myshopify.com`;
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain);
}

// Shopify (с 1 января 2026, Dev Dashboard): домен магазина + Client ID —
// сам ключ (apiKey) для Shopify теперь означает Client Secret, а не готовый
// shpat_ токен (см. lib/shopify-token.mjs). Meta Ads требует одно доп. поле
// (Ad Account ID). Google Ads требует сразу четыре: Customer ID, OAuth
// Client ID/Secret, Developer Token — без них refresh token из основного
// поля нечем обменять на access token.
// PayPal: apiKey = Client Secret (шифрується як завжди), config.client_id —
// публічний ідентифікатор застосунку клієнта в developer.paypal.com, як і
// client_id у Shopify/Google Ads тут не секрет сам по собі, тому лишається
// у відкритому config (щоб UI міг показати збережене значення), а не в
// SENSITIVE_CONFIG_FIELDS нижче.
// WooCommerce: store_url (домен клієнта, довільний) + consumer_key —
// сам apiKey означає Consumer Secret (та сама роль, що й Client Secret у
// Shopify). Див. lib/woocommerce-url.js — тут своя SSRF-перевірка, бо
// домен WooCommerce не обмежений фіксованим суфіксом, як *.myshopify.com.
const REQUIRED_CONFIG_FIELDS = {
  shopify: ["shop_domain", "client_id"],
  woocommerce: ["store_url", "consumer_key"],
  meta_ads: ["ad_account_id"],
  google_ads: ["customer_id", "client_id", "client_secret", "developer_token"],
  paypal: ["client_id"],
};

// client_secret и developer_token — секреты не хуже самого API-ключа. /api/integrations-status
// отдаёт весь config клиенту как есть (чтобы UI мог показать сохранённый Customer ID и т.п.) —
// поэтому эти поля нельзя класть в config как есть, только в зашифрованный payload вместе
// с apiKey. customer_id и client_id секретами не являются (client_id по дизайну OAuth публичный,
// customer_id — просто номер аккаунта) — их можно смело отдавать обратно в UI.
const SENSITIVE_CONFIG_FIELDS = {
  google_ads: ["client_secret", "developer_token"],
};

export async function POST(req) {
  try {
    const { provider, apiKey, config } = await req.json();
    const { email } = await requireUser();

    if (!provider || !apiKey) {
      return Response.json({ error: "provider and apiKey are required" }, { status: 400 });
    }
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
      return Response.json({ error: "Unsupported provider" }, { status: 400 });
    }
    if (!looksLikeAKey(apiKey)) {
      return Response.json({ error: "Key looks too short — check you copied it fully" }, { status: 400 });
    }

    // Shopify и Meta Ads требуют одно доп. поле помимо ключа, Google Ads — сразу четыре
    // (см. REQUIRED_CONFIG_FIELDS выше).
    const requiredFields = REQUIRED_CONFIG_FIELDS[provider] || [];
    const missingField = requiredFields.find((f) => !config?.[f]?.trim());
    if (missingField) {
      return Response.json({ error: `${missingField} is required for ${provider}` }, { status: 400 });
    }
    if (provider === "shopify" && !isValidShopifyDomain(config?.shop_domain)) {
      return Response.json({ error: "invalid_shop_domain" }, { status: 400 });
    }

    // ФІКС (SSRF, той самий принцип, що і для Shopify вище, п.2 захисту —
    // домен WooCommerce довільний, тому мало перевірити синтаксис, треба
    // ще й резолвнути хост і відкинути приватні/reserved адреси ДО того,
    // як ключі взагалі потраплять у БД, а не тільки при першому синку).
    let normalizedStoreUrl = null;
    if (provider === "woocommerce") {
      normalizedStoreUrl = normalizeStoreUrl(config?.store_url);
      if (!normalizedStoreUrl) {
        return Response.json({ error: "invalid_store_url" }, { status: 400 });
      }
      try {
        await assertPublicHostname(new URL(normalizedStoreUrl).hostname);
      } catch (e) {
        return Response.json({ error: "store_url_not_reachable" }, { status: 400 });
      }
    }

    const { data: user } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    if (!user) return Response.json({ error: "User not found" }, { status: 404 });

    // ВАЖЛИВО (фікс під тарифну логіку зі слотами інтеграцій): підключення
    // дозволене лише якщо план необмежений (scale/trial) АБО провайдер є
    // серед обраних слотів клієнта. Це той самий захист, що вже стоїть у
    // /api/connect-stripe — тут він потрібен так само, бо саме через цей
    // роут підключаються Shopify/Meta Ads/Google Ads (ручний ввід ключа).
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
      if (!selected.includes(provider)) {
        return Response.json(
          {
            error: "provider_not_selected",
            message: `Оберіть ${provider} у налаштуваннях інтеграцій перед підключенням`,
          },
          { status: 403 }
        );
      }
    }

    // order+limit — без ORDER BY при дублях businesses (см. race condition
    // в business-profile/route.js) .maybeSingle() падает с ошибкой на 2+
    // строках, и business молча становится undefined.
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

    const cleanConfig = config && typeof config === "object" ? { ...config } : {};
    // Зберігаємо саме нормалізовану (https://host, без шляху/трейлінг слеша)
    // версію store_url — так sync-модуль завжди отримує однаковий формат,
    // незалежно від того, що саме ввів клієнт (з http://, з трейлінг слешем тощо).
    if (provider === "woocommerce" && normalizedStoreUrl) {
      cleanConfig.store_url = normalizedStoreUrl;
    }
    // Одноразовий бекфіл історії при (пере)підключенні — see
    // app/api/cron/backfill-historical/route.js. Прапорець просто в config
    // (jsonb, вже є в таблиці) — без міграції схеми. Крон сам скидає його
    // після того, як витягне історичні дані.
    cleanConfig.backfill_pending = true;

    // ФІКС (задвоєння/тиха втрата доходу, той самий guard, що і в
    // /api/integration-revenue-mode): revenue_mode тут ще не прийшов
    // з чекбокса окремо — якщо showRevenueModeCheckbox не показувався
    // (напр. перше підключення) або чекбокс не відмічений, дефолт саме
    // "replace" (effectiveRevenueMode), не "add". Перевіряємо конфлікт
    // ДО insert/update, а не після — щоб щойно підключений провайдер і
    // вже наявний replace-сусід не встигли жодного разу одночасно
    // відсинкатись у "replace"-режимі обидва.
    let downgraded = [];
    if (REPLACE_TOGGLE_PROVIDERS.includes(provider)) {
      downgraded = await downgradeConflictingReplaceProviders(
        admin,
        business.id,
        provider,
        effectiveRevenueMode(cleanConfig)
      );
    }

    // Вырезаем секретные поля (client_secret, developer_token у Google Ads) из config —
    // они уйдут в зашифрованный payload вместе с apiKey, а не будут храниться в открытом
    // виде и отдаваться клиенту через /api/integrations-status.
    const sensitiveFields = SENSITIVE_CONFIG_FIELDS[provider] || [];
    const secretExtras = {};
    for (const f of sensitiveFields) {
      if (cleanConfig[f] !== undefined) {
        secretExtras[f] = cleanConfig[f];
        delete cleanConfig[f];
      }
    }

    // Для провайдеров без доп. секретов (Stripe/Shopify/Meta Ads) шифруем просто строку
    // apiKey как раньше — их sync-модули (decrypt(...)) ожидают обычную строку, не JSON.
    const secretPayload = sensitiveFields.length
      ? JSON.stringify({ refresh_token: apiKey.trim(), ...secretExtras })
      : apiKey.trim();
    const encrypted = encrypt(secretPayload);
    const keyPreview = apiKey.trim().slice(0, 8) + "..." + apiKey.trim().slice(-4);

    const { data: existing } = await admin
      .from("integrations")
      .select("id")
      .eq("business_id", business.id)
      .eq("provider", provider)
      .maybeSingle();

    if (existing) {
      const { error: updateErr } = await admin
        .from("integrations")
        .update({ api_key_encrypted: encrypted, status: "connected", key_preview: keyPreview, config: cleanConfig })
        .eq("id", existing.id);
      if (updateErr) {
        console.error("connect-integration update error:", updateErr);
        return Response.json({ error: `Database error: ${updateErr.message}` }, { status: 500 });
      }
    } else {
      const { error: insertErr } = await admin.from("integrations").insert({
        business_id: business.id,
        provider,
        api_key_encrypted: encrypted,
        status: "connected",
        key_preview: keyPreview,
        config: cleanConfig,
      });
      if (insertErr) {
        console.error("connect-integration insert error:", insertErr);
        return Response.json({ error: `Database error: ${insertErr.message}` }, { status: 500 });
      }
    }

    return Response.json({ success: true, downgraded });
  } catch (err) {
    if (err instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    console.error("connect-integration error:", err);
    return Response.json({ error: "Server error, try again" }, { status: 500 });
  }
}

// Отключение (mirрор /api/stripe-disconnect, но для generic-провайдеров).
export async function DELETE(req) {
  try {
    const { provider } = await req.json();
    const { email } = await requireUser();
    if (!provider) {
      return Response.json({ error: "provider is required" }, { status: 400 });
    }
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
      return Response.json({ error: "Unsupported provider" }, { status: 400 });
    }

    const { data: user } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    if (!user) return Response.json({ error: "not found" }, { status: 404 });

    const { data: business } = await admin
      .from("businesses")
      .select("id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!business) return Response.json({ error: "not found" }, { status: 404 });

    await admin
      .from("integrations")
      .update({ status: "disconnected", api_key_encrypted: null, key_preview: null })
      .eq("business_id", business.id)
      .eq("provider", provider);

    // ФІКС (обговорення 30.08.2026, той самий принцип, що і в
    // /api/stripe-disconnect): резолвимо алерти цього провайдера, щоб вони
    // не висіли "open" назавжди після відключення й не потрапляли в
    // майбутні звіти/Risks tab про джерело, якого вже немає.
    const ALERT_TYPE_BY_PROVIDER = {
      meta_ads: ["sync_failure_meta_ads"],
      google_ads: ["sync_failure_google_ads"],
      shopify: ["sync_failure_shopify"],
      paypal: ["sync_failure_paypal"],
      woocommerce: ["sync_failure_woocommerce", "shipping_spike_woocommerce"],
    };
    const alertTypes = ALERT_TYPE_BY_PROVIDER[provider];
    if (alertTypes) {
      await admin
        .from("alerts_log")
        .update({ status: "resolved" })
        .eq("business_id", business.id)
        .eq("status", "open")
        .in("type", alertTypes);
    }

    return Response.json({ success: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    console.error("connect-integration DELETE error:", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}