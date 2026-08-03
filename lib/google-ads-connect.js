// lib/google-ads-connect.js
//
// Записує результат OAuth-підключення Google Ads у таблицю integrations —
// той самий формат, який очікує scripts/google-ads-sync.mjs (config.customer_id
// / config.client_id відкриті, refresh_token+client_secret+developer_token —
// зашифрований JSON), тож sync-модуль лишається без змін незалежно від того,
// прийшли креди через ручний ввід (старий флоу) чи через OAuth (цей файл).
const { createClient } = require("@supabase/supabase-js");
const { encrypt } = require("./crypto");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function resolveBusinessId(email) {
  const { data: user } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!user) throw new Error("user_not_found");

  const { data: business } = await admin.from("businesses").select("id").eq("user_id", user.id).maybeSingle();
  if (!business) throw new Error("business_profile_incomplete");

  return business.id;
}

async function finalizeGoogleAdsConnection({ email, customerId, refreshToken }) {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!clientId || !clientSecret || !developerToken) {
    throw new Error("google_ads_oauth_not_configured");
  }
  if (!email || !customerId || !refreshToken) {
    throw new Error("missing_connection_data");
  }

  const businessId = await resolveBusinessId(email);

  const secretPayload = JSON.stringify({
    refresh_token: refreshToken,
    client_secret: clientSecret,
    developer_token: developerToken,
  });
  const encrypted = encrypt(secretPayload);
  const keyPreview = `customer ${customerId}`;
  const config = { customer_id: customerId, client_id: clientId };

  const { data: existing } = await admin
    .from("integrations")
    .select("id")
    .eq("business_id", businessId)
    .eq("provider", "google_ads")
    .maybeSingle();

  if (existing) {
    const { error } = await admin
      .from("integrations")
      .update({ api_key_encrypted: encrypted, status: "connected", key_preview: keyPreview, config })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin.from("integrations").insert({
      business_id: businessId,
      provider: "google_ads",
      api_key_encrypted: encrypted,
      status: "connected",
      key_preview: keyPreview,
      config,
    });
    if (error) throw new Error(error.message);
  }

  return { businessId };
}

module.exports = { finalizeGoogleAdsConnection };
