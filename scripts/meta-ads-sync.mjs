// scripts/meta-ads-sync.mjs
//
// Этап 3 плана — sync-модуль для Meta Ads. Тот же паттерн: расшифровать
// токен -> запрос к Marketing API insights -> запись в expenses -> ошибки в error_logs.
//
// Требует long-lived System User токен с правом ads_read (создаётся в
// Meta Business Suite -> System Users, не протухает как обычный User Token).
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../lib/crypto.js";
import { logError } from "../lib/log-error.js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const GRAPH_API_VERSION = "v19.0";

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

async function fetchMetaSpend(adAccountId, token, sinceDate, untilDate) {
  const accountId = adAccountId.replace(/^act_/, "");
  const timeRange = encodeURIComponent(JSON.stringify({ since: sinceDate, until: untilDate }));
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/act_${accountId}/insights?fields=spend&time_range=${timeRange}&time_increment=1&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Meta API error: ${data.error?.message || res.status}`);
  }
  return data.data || []; // [{ spend, date_start, date_stop }, ...]
}

// Идемпотентная запись — как в shopify-sync.mjs: удаляем старую строку за
// этот business+date+source+category и вставляем свежую, без дублей.
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
    .eq("provider", "meta_ads")
    .eq("status", "connected");
  if (businessId) query = query.eq("business_id", businessId);
  const { data: integrations, error: fetchErr } = await query;

  if (fetchErr) {
    console.error("Failed to fetch meta_ads integrations:", fetchErr.message);
    return;
  }
  if (!integrations?.length) {
    console.log("No connected Meta Ads integrations, nothing to sync.");
    return;
  }

  const until = new Date();
  const since = new Date(Date.now() - 2 * 24 * 3600 * 1000); // последние 48ч, как у Stripe/Shopify

  for (const integ of integrations) {
    try {
      const adAccountId = integ.config?.ad_account_id?.trim();
      if (!adAccountId) {
        throw new Error("Missing ad_account_id in integration config");
      }
      const token = decrypt(integ.api_key_encrypted);
      const rows = await fetchMetaSpend(adAccountId, token, toDateStr(since), toDateStr(until));

      for (const row of rows) {
        const amount = Number(row.spend) || 0;
        await upsertExpense({
          businessId: integ.business_id,
          date: row.date_start,
          amount: Number(amount.toFixed(2)),
          category: "advertising",
          source: "meta_ads",
          description: "Meta Ads spend (auto-synced)",
        });
      }

      await admin
        .from("integrations")
        .update({ last_synced_at: new Date().toISOString(), status: "connected" })
        .eq("id", integ.id);

      console.log(`Meta Ads synced business ${integ.business_id}: ${rows.length} day(s)`);
    } catch (err) {
      console.error(`Failed to sync Meta Ads integration ${integ.id}:`, err.message);
      await logError({
        source: "meta_ads",
        message: `Sync failed for integration ${integ.id}`,
        details: err.message,
        businessId: integ.business_id,
      });
      await admin.from("integrations").update({ status: "error" }).eq("id", integ.id);
    }
  }
}

export async function runSync(businessId) {
  await main(businessId);
  return { synced: true, timestamp: new Date().toISOString() };
}
