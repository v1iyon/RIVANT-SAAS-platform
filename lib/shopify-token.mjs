// lib/shopify-token.mjs
//
// С 1 января 2026 Shopify больше не показывает готовый Admin API токен
// (shpat_...) в интерфейсе для новых кастомных приложений — они теперь
// создаются через Dev Dashboard и выдают только Client ID + Client Secret.
// Access token нужно получать программно через client_credentials grant:
// https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
//
// Токен живёт 24 часа (expires_in всегда 86399). Мы не храним и не обновляем
// его отдельно — синк идёт раз в час (.github/workflows/sync-stripe.yml),
// поэтому каждый прогон просто запрашивает свежий токен под сохранённые
// Client ID/Secret. Сами Client ID/Secret не истекают — пользователю не
// нужно ничего переподключать.

export async function getShopifyAccessToken(shopDomain, clientId, clientSecret) {
  const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Shopify token request failed: ${res.status} — ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Shopify token response missing access_token");
  }
  return data.access_token;
}

// Интеграции, подключённые ДО миграции, хранят в api_key_encrypted готовый
// shpat_ токен и не имеют config.client_id — они продолжают работать как
// раньше, без переподключения (Shopify: "existing admin-created custom apps
// continue to work"). Новые подключения (с client_id в config) идут через
// client_credentials grant и получают свежий access token на каждый прогон.
export async function resolveShopifyToken({ shopDomain, secretPayload, clientId }) {
  if (clientId) {
    return getShopifyAccessToken(shopDomain, clientId, secretPayload);
  }
  return secretPayload; // legacy-режим: secretPayload уже готовый shpat_ токен
}
