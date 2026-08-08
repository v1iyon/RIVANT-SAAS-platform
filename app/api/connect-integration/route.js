// app/api/connect-integration/route.js
import { createClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/crypto";

export const runtime = "nodejs";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SUPPORTED_PROVIDERS = ["meta_ads", "google_ads", "shopify", "quickbooks", "google_analytics"];

// Простая проверка "непустой строки разумной длины" — реальная проверка валидности
// ключа у каждого провайдера своя (Этап 3, sync-модули), сюда её добавим позже.
function looksLikeAKey(value) {
  return typeof value === "string" && value.trim().length >= 8;
}

// Shopify и Meta Ads требуют одно доп. поле (домен магазина / Ad Account ID).
// Google Ads требует сразу четыре: Customer ID, OAuth Client ID/Secret, Developer Token —
// без них refresh token из основного поля нечем обменять на access token.
const REQUIRED_CONFIG_FIELDS = {
  shopify: ["shop_domain"],
  meta_ads: ["ad_account_id"],
  google_ads: ["customer_id", "client_id", "client_secret", "developer_token"],
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
    const { email, provider, apiKey, config } = await req.json();

    if (!email || !provider || !apiKey) {
      return Response.json({ error: "email, provider and apiKey are required" }, { status: 400 });
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

    const { data: user } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    if (!user) return Response.json({ error: "User not found" }, { status: 404 });

    const { data: business } = await admin
      .from("businesses")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!business) {
      return Response.json(
        { error: "Complete your business profile first (Settings → Company Name)" },
        { status: 400 }
      );
    }

    const cleanConfig = config && typeof config === "object" ? { ...config } : {};

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

    return Response.json({ success: true });
  } catch (err) {
    console.error("connect-integration error:", err);
    return Response.json({ error: "Server error, try again" }, { status: 500 });
  }
}

// Отключение (mirрор /api/stripe-disconnect, но для generic-провайдеров).
export async function DELETE(req) {
  try {
    const { email, provider } = await req.json();
    if (!email || !provider) {
      return Response.json({ error: "email and provider are required" }, { status: 400 });
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
      .maybeSingle();
    if (!business) return Response.json({ error: "not found" }, { status: 404 });

    await admin
      .from("integrations")
      .update({ status: "disconnected", api_key_encrypted: null, key_preview: null })
      .eq("business_id", business.id)
      .eq("provider", provider);

    return Response.json({ success: true });
  } catch (err) {
    console.error("connect-integration DELETE error:", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}