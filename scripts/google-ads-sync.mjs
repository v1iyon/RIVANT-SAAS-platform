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
import { sendAlertToBusiness, getUserContact, generateAlertExplanation, detectExpenseAnomaly, detectCacAnomaly, formatTechnicalDetail } from "../lib/alerts.mjs";

// ВАЖНО: reason (err.message) сюда больше НЕ подставляется — это сырой
// текст ошибки от Google Ads API, всегда на английском. Раньше он клеился
// прямо в локализованное предложение ("Не вдалося синхронізувати Google
// Ads: Google Ads API error: ...") — получалось наполовину на украинском,
// наполовину на английском в одной строке. Теперь заголовок алерта всегда
// полностью на одном языке; сырая причина уходит отдельной подписанной
// строкой через formatTechnicalDetail() ниже.
const SYNC_FAILURE_MESSAGE = {
  UA: () => `Не вдалося синхронізувати Google Ads`,
  EN: () => `Failed to sync Google Ads`,
  DE: () => `Google Ads Synchronisierung fehlgeschlagen`,
};

const SPEND_SPIKE_MESSAGE = {
  UA: (pct, avg, today, date) => `Витрати на Google Ads зросли на ${pct}% (з $${Math.round(avg)} до $${Math.round(today)}) ${date}`,
  EN: (pct, avg, today, date) => `Google Ads spend jumped ${pct}% (from $${Math.round(avg)} to $${Math.round(today)}) on ${date}`,
  DE: (pct, avg, today, date) => `Google Ads-Ausgaben sind am ${date} um ${pct}% gestiegen (von $${Math.round(avg)} auf $${Math.round(today)})`,
};

const SPEND_DROP_MESSAGE = {
  UA: (avg, today, date) => `Витрати на Google Ads різко впали до $${Math.round(today)} ${date} (середнє — $${Math.round(avg)}/день) — можливо, кампанію зупинено`,
  EN: (avg, today, date) => `Google Ads spend dropped sharply to $${Math.round(today)} on ${date} (avg $${Math.round(avg)}/day) — campaigns may have paused`,
  DE: (avg, today, date) => `Google Ads-Ausgaben sind am ${date} stark auf $${Math.round(today)} gefallen (Ø $${Math.round(avg)}/Tag) — Kampagnen könnten pausiert sein`,
};

const CAC_SPIKE_MESSAGE = {
  UA: (pct, avgCac, cacToday, date) => `CAC зріс на ${pct}% (з $${avgCac.toFixed(2)} до $${cacToday.toFixed(2)} за клієнта) ${date}`,
  EN: (pct, avgCac, cacToday, date) => `CAC rose ${pct}% (from $${avgCac.toFixed(2)} to $${cacToday.toFixed(2)} per customer) on ${date}`,
  DE: (pct, avgCac, cacToday, date) => `CAC ist am ${date} um ${pct}% gestiegen (von $${avgCac.toFixed(2)} auf $${cacToday.toFixed(2)} pro Kunde)`,
};

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const GOOGLE_ADS_API_VERSION = "v24";

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

async function getBusinessUserId(businessId) {
  const { data } = await admin.from("businesses").select("user_id").eq("id", businessId).maybeSingle();
  return data?.user_id ?? null;
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

      // Перевіряємо аномалії тільки за останню (найсвіжішу) дату з вікна синку —
      // старіші дні вже перевірялись на попередніх прогонах.
      const dates = Object.keys(byDate).sort();
      if (dates.length) {
        const latestDate = dates[dates.length - 1];
        const latestAmount = byDate[latestDate];
        const contact = await getUserContact(await getBusinessUserId(integ.business_id));

        const anomaly = await detectExpenseAnomaly({
          businessId: integ.business_id,
          source: "google_ads",
          category: "advertising",
          date: latestDate,
          todayAmount: latestAmount,
        });
        if (anomaly?.kind === "spike") {
          const msg = (SPEND_SPIKE_MESSAGE[contact.userLang] || SPEND_SPIKE_MESSAGE.EN)(anomaly.pct, anomaly.avg, anomaly.today, latestDate);
          const explanation = await generateAlertExplanation(
            contact.userLang,
            `Google Ads daily spend jumped ${anomaly.pct}% versus the 7-day average (from $${Math.round(anomaly.avg)} to $${Math.round(anomaly.today)}) on ${latestDate}.`
          );
          await sendAlertToBusiness(integ.business_id, contact, {
            type: "ad_spend_spike_google_ads",
            severity: anomaly.pct >= 100 ? "high" : "medium",
            message: msg,
            aiExplanation: explanation,
          });
        } else if (anomaly?.kind === "drop") {
          const msg = (SPEND_DROP_MESSAGE[contact.userLang] || SPEND_DROP_MESSAGE.EN)(anomaly.avg, anomaly.today, latestDate);
          const explanation = await generateAlertExplanation(
            contact.userLang,
            `Google Ads daily spend dropped to $${Math.round(anomaly.today)} on ${latestDate}, versus a 7-day average of $${Math.round(anomaly.avg)}/day — this usually means a campaign was paused, disapproved, or a payment method failed.`
          );
          await sendAlertToBusiness(integ.business_id, contact, {
            type: "ad_spend_drop_google_ads",
            severity: "high",
            message: msg,
            aiExplanation: explanation,
          });
        }

        const cacAnomaly = await detectCacAnomaly({ businessId: integ.business_id, date: latestDate });
        if (cacAnomaly) {
          const msg = (CAC_SPIKE_MESSAGE[contact.userLang] || CAC_SPIKE_MESSAGE.EN)(cacAnomaly.pct, cacAnomaly.avgCac, cacAnomaly.cacToday, latestDate);
          const explanation = await generateAlertExplanation(
            contact.userLang,
            `Customer acquisition cost (CAC) rose ${cacAnomaly.pct}% versus the 7-day average (from $${cacAnomaly.avgCac.toFixed(2)} to $${cacAnomaly.cacToday.toFixed(2)} per customer) on ${latestDate}, based on $${cacAnomaly.totalSpend.toFixed(2)} total ad spend across ${cacAnomaly.orders} orders.`
          );
          await sendAlertToBusiness(integ.business_id, contact, {
            type: "cac_spike",
            severity: cacAnomaly.pct >= 80 ? "high" : "medium",
            message: msg,
            aiExplanation: explanation,
          });
        }
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

      const contact = await getUserContact(await getBusinessUserId(integ.business_id));
      const msg = (SYNC_FAILURE_MESSAGE[contact.userLang] || SYNC_FAILURE_MESSAGE.EN)();
      let explanation = await generateAlertExplanation(
        contact.userLang,
        `The Google Ads integration was previously connected and syncing successfully. It just failed with this error: "${err.message}". This usually means the refresh token was revoked or the developer token lost access.`
      );
      // Сирую причину (всегда на английском) добавляем отдельной подписанной
      // строкой — а не смешиваем с локализованным текстом объяснения.
      explanation = `${explanation}${formatTechnicalDetail(contact.userLang, err.message)}`;
      await sendAlertToBusiness(integ.business_id, contact, {
        type: "sync_failure_google_ads",
        severity: "high",
        message: msg,
        aiExplanation: explanation,
      });
    }
  }
}

export async function runSync(businessId) {
  await main(businessId);
  return { synced: true, timestamp: new Date().toISOString() };
}
