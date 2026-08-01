// app/api/connect-integration/route.js
import { createClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/crypto";

export const runtime = "nodejs";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SUPPORTED_PROVIDERS = ["meta_ads", "google_ads", "shopify", "quickbooks", "plaid"];

// Простая проверка "непустой строки разумной длины" — реальная проверка валидности
// ключа у каждого провайдера своя (Этап 3, sync-модули), сюда её добавим позже.
function looksLikeAKey(value) {
  return typeof value === "string" && value.trim().length >= 8;
}

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

    // Shopify и Meta Ads требуют доп. поле помимо ключа — домен магазина
    // и Ad Account ID соответственно. Google Ads/QuickBooks (OAuth) сюда пока не входят.
    const REQUIRED_CONFIG_FIELD = { shopify: "shop_domain", meta_ads: "ad_account_id" };
    const requiredField = REQUIRED_CONFIG_FIELD[provider];
    if (requiredField && !config?.[requiredField]?.trim()) {
      return Response.json({ error: `${requiredField} is required for ${provider}` }, { status: 400 });
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

    const encrypted = encrypt(apiKey.trim());
    const keyPreview = apiKey.trim().slice(0, 8) + "..." + apiKey.trim().slice(-4);
    const cleanConfig = config && typeof config === "object" ? config : {};

    const { data: existing } = await admin
      .from("integrations")
      .select("id")
      .eq("business_id", business.id)
      .eq("provider", provider)
      .maybeSingle();

    if (existing) {
      await admin
        .from("integrations")
        .update({ api_key_encrypted: encrypted, status: "connected", key_preview: keyPreview, config: cleanConfig })
        .eq("id", existing.id);
    } else {
      await admin.from("integrations").insert({
        business_id: business.id,
        provider,
        api_key_encrypted: encrypted,
        status: "connected",
        key_preview: keyPreview,
        config: cleanConfig,
      });
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