// scripts/google-ads-sync.mjs
//
// Этап 3 плана (п.5) — sync-модуль для Google Ads. Тот же паттерн, что у
// Shopify/Meta Ads: расшифровать креды -> запрос к Google Ads API -> запись
// в expenses -> ошибки в error_logs.
//
// В отличие от Meta Ads (долгоживущий System User токен), Google Ads требует
// полноценный OAuth2: refresh_token нужно обменивать на access_token перед
// каждым запросом (access_token живёт ~1 час). Пользователь один раз получает
// refresh_token через Google OAuth Playground (используя свой developer_token
// и свой OAuth-клиент — client_id/client_secret, созданный в Google Cloud
// Console), а дальше всё обновляется автоматически.
//
// api_key_encrypted хранит НЕ просто refresh_token, а зашифрованный JSON:
// { refresh_token, client_secret, developer_token } — client_secret и
// developer_token достаточно чувствительны, чтобы не держать их в открытом
// config (см. /api/connect-integration/route.js, SENSITIVE_CONFIG_FIELDS).
// customer_id и client_id остаются в config как есть — они не секретны.
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../lib/crypto.js";
import { logError } from "../lib/log-error.js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const GOOGLE_ADS_API_VERSION = "v24";

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

// refresh_token живёт долго, но сам по себе бесполезен для вызова Google Ads API —
// его нужно обменять на access_token (живёт ~1 час) при каждом прогоне синка.
async function refreshAccessToken(clientId, clientSecret, refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Google OAuth token refresh failed: ${data.error_description || data.error || res.status}`);
  }
  return data.access_token;
}

// GAQL-запрос по расходам на уровне кампаний за окно синка, с пагинацией —
// у крупного аккаунта за 48ч вместе с разбивкой по кампаниям и дням легко
// может быть >10000 строк (дефолтный page size), одной страницей не обойтись.
async function fetchGoogleAdsCost(customerId, accessToken, developerToken, sinceDate, untilDate) {
  const query = `
    SELECT segments.date, metrics.cost_micros
    FROM campaign
    WHERE segments.date BETWEEN '${sinceDate}' AND '${untilDate}'
  `.trim();

  const results = [];
  let pageToken = undefined;

  do {
    const res = await fetch(
      `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:search`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": developerToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(pageToken ? { query, pageToken } : { query }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      const message = data?.error?.message || data?.[0]?.error?.message || res.status;
      throw new Error(`Google Ads API error: ${message}`);
    }
    for (const row of data.results || []) results.push(row);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return results;
}

// Идемпотентная запись — как в shopify-sync.mjs/meta-ads-sync.mjs: удаляем
// старую строку за этот business+date+source+category и вставляем свежую.
async function upsertExpense({ businessId, date, amount, category, source, description }) {
  await admin
    .from("expenses")
    .delete()
    .eq("business_id", businessId)
    .eq("date", date)
    .eq("source", source)
    .eq("category", category);

  if (amount > 0) {
    await admin.from("expenses").insert({
      business_id: businessId,
      amount,
      category,
      description,
      date,
      source,
    });
  }
}

async function main(businessId) {
  let query = admin
    .from("integrations")
    .select("id, business_id, api_key_encrypted, config")
    .eq("provider", "google_ads")
    .eq("status", "connected");
  if (businessId) query = query.eq("business_id", businessId);
  const { data: integrations, error: fetchErr } = await query;

  if (fetchErr) {
    console.error("Failed to fetch google_ads integrations:", fetchErr.message);
    return;
  }
  if (!integrations?.length) {
    console.log("No connected Google Ads integrations, nothing to sync.");
    return;
  }

  const until = new Date();
  const since = new Date(Date.now() - 2 * 24 * 3600 * 1000); // последние 48ч, как у Stripe/Shopify/Meta Ads

  for (const integ of integrations) {
    try {
      const customerId = integ.config?.customer_id?.trim();
      const clientId = integ.config?.client_id?.trim();
      if (!customerId) throw new Error("Missing customer_id in integration config");
      if (!clientId) throw new Error("Missing client_id in integration config");

      let secrets;
      try {
        secrets = JSON.parse(decrypt(integ.api_key_encrypted));
      } catch {
        throw new Error("Stored credentials are corrupted — reconnect Google Ads");
      }
      const { refresh_token: refreshToken, client_secret: clientSecret, developer_token: developerToken } = secrets;
      if (!refreshToken || !clientSecret || !developerToken) {
        throw new Error("Missing refresh_token/client_secret/developer_token — reconnect Google Ads");
      }

      const accessToken = await refreshAccessToken(clientId, clientSecret, refreshToken);
      const rows = await fetchGoogleAdsCost(customerId, accessToken, developerToken, toDateStr(since), toDateStr(until));

      const byDate = {};
      for (const row of rows) {
        const date = row.segments?.date;
        const costMicros = Number(row.metrics?.costMicros) || 0;
        if (!date) continue;
        byDate[date] = (byDate[date] || 0) + costMicros / 1_000_000;
      }

      for (const [date, amount] of Object.entries(byDate)) {
        await upsertExpense({
          businessId: integ.business_id,
          date,
          amount: Number(amount.toFixed(2)),
          category: "advertising",
          source: "google_ads",
          description: "Google Ads spend (auto-synced)",
        });
      }

      await admin
        .from("integrations")
        .update({ last_synced_at: new Date().toISOString(), status: "connected" })
        .eq("id", integ.id);

      console.log(`Google Ads synced business ${integ.business_id}: ${Object.keys(byDate).length} day(s)`);
    } catch (err) {
      console.error(`Failed to sync Google Ads integration ${integ.id}:`, err.message);
      await logError({
        source: "google_ads",
        message: `Sync failed for integration ${integ.id}`,
        details: err.message,
        businessId: integ.business_id,
      });
      // Помечаем интеграцию как проблемную (видно в /admin), но не отключаем —
      // синк для остальных интеграций продолжается благодаря try/catch на каждой.
      await admin.from("integrations").update({ status: "error" }).eq("id", integ.id);
    }
  }
}

export async function runSync(businessId) {
  await main(businessId);
  return { synced: true, timestamp: new Date().toISOString() };
}
