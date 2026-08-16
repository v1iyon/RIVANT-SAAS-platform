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
import { sendAlertToBusiness, getUserContact, generateAlertExplanation, detectExpenseAnomaly, detectCacAnomaly, getAlertSensitivity } from "../lib/alerts.mjs";

const SYNC_FAILURE_MESSAGE = {
  UA: () => `Не вдалося синхронізувати Meta Ads`,
  EN: () => `Failed to sync Meta Ads`,
  DE: () => `Meta Ads Synchronisierung fehlgeschlagen`,
};

const SPEND_SPIKE_MESSAGE = {
  UA: (pct, avg, today, date) => `Витрати на Meta Ads зросли на ${pct}% (з $${Math.round(avg)} до $${Math.round(today)}) ${date}`,
  EN: (pct, avg, today, date) => `Meta Ads spend jumped ${pct}% (from $${Math.round(avg)} to $${Math.round(today)}) on ${date}`,
  DE: (pct, avg, today, date) => `Meta Ads-Ausgaben sind am ${date} um ${pct}% gestiegen (von $${Math.round(avg)} auf $${Math.round(today)})`,
};

const SPEND_DROP_MESSAGE = {
  UA: (avg, today, date) => `Витрати на Meta Ads різко впали до $${Math.round(today)} ${date} (середнє — $${Math.round(avg)}/день) — можливо, кампанію зупинено`,
  EN: (avg, today, date) => `Meta Ads spend dropped sharply to $${Math.round(today)} on ${date} (avg $${Math.round(avg)}/day) — campaigns may have paused`,
  DE: (avg, today, date) => `Meta Ads-Ausgaben sind am ${date} stark auf $${Math.round(today)} gefallen (Ø $${Math.round(avg)}/Tag) — Kampagnen könnten pausiert sein`,
};

const CAC_SPIKE_MESSAGE = {
  UA: (pct, avgCac, cacToday, date) => `CAC зріс на ${pct}% (з $${avgCac.toFixed(2)} до $${cacToday.toFixed(2)} за клієнта) ${date}`,
  EN: (pct, avgCac, cacToday, date) => `CAC rose ${pct}% (from $${avgCac.toFixed(2)} to $${cacToday.toFixed(2)} per customer) on ${date}`,
  DE: (pct, avgCac, cacToday, date) => `CAC ist am ${date} um ${pct}% gestiegen (von $${avgCac.toFixed(2)} auf $${cacToday.toFixed(2)} pro Kunde)`,
};

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const GRAPH_API_VERSION = "v19.0";

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

async function getBusinessUserId(businessId) {
  const { data } = await admin.from("businesses").select("user_id").eq("id", businessId).maybeSingle();
  return data?.user_id ?? null;
}

async function fetchMetaSpend(adAccountId, token, sinceDate, untilDate) {
  const accountId = adAccountId.replace(/^act_/, "");
  const timeRange = encodeURIComponent(JSON.stringify({ since: sinceDate, until: untilDate }));
  let url = `https://graph.facebook.com/${GRAPH_API_VERSION}/act_${accountId}/insights?fields=spend&time_range=${timeRange}&time_increment=1&limit=500&access_token=${encodeURIComponent(token)}`;
  // Пагінація: за замовчуванням (48г вікно, 1-2 дні) Meta завжди вкладається
  // в одну сторінку, тому раніше paging.next просто ігнорувався. Для
  // бекфілу (до 365 днів) це вже не гарантовано — Meta Insights API теж
  // пагінує великі time-series відповіді, без цього старі місяці мовчки
  // обрізались б.
  let all = [];
  let guard = 0;
  while (url && guard < 20) {
    guard += 1;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(`Meta API error: ${data.error?.message || res.status}`);
    }
    all = all.concat(data.data || []);
    url = data.paging?.next || null;
  }
  return all; // [{ spend, date_start, date_stop }, ...]
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

async function main(businessId, options = {}) {
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
  const since = new Date(Date.now() - (options.sinceDays ? options.sinceDays * 24 : 2 * 24) * 3600 * 1000); // 48ч за замовчуванням, ширше — лише для бекфілу

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

      // Перевіряємо аномалії тільки за останню (найсвіжішу) дату з вікна синку —
      // старіші дні вже перевірялись на попередніх прогонах.
      if (rows.length) {
        const latestDate = rows.map((r) => r.date_start).sort().pop();
        const latestAmount = Number(rows.find((r) => r.date_start === latestDate)?.spend) || 0;
        const contact = await getUserContact(await getBusinessUserId(integ.business_id));
        const sensitivityMultiplier = await getAlertSensitivity(integ.business_id);

        const anomaly = await detectExpenseAnomaly({
          businessId: integ.business_id,
          source: "meta_ads",
          category: "advertising",
          date: latestDate,
          todayAmount: latestAmount,
          sensitivityMultiplier,
        });
        if (anomaly?.kind === "spike") {
          const msg = (SPEND_SPIKE_MESSAGE[contact.userLang] || SPEND_SPIKE_MESSAGE.EN)(anomaly.pct, anomaly.avg, anomaly.today, latestDate);
          const explanation = await generateAlertExplanation(
            contact.userLang,
            `Meta Ads daily spend jumped ${anomaly.pct}% versus the 7-day average (from $${Math.round(anomaly.avg)} to $${Math.round(anomaly.today)}) on ${latestDate}.`
          );
          await sendAlertToBusiness(integ.business_id, contact, {
            type: "ad_spend_spike_meta_ads",
            severity: anomaly.pct >= 100 ? "high" : "medium",
            message: msg,
            aiExplanation: explanation,
          });
        } else if (anomaly?.kind === "drop") {
          const msg = (SPEND_DROP_MESSAGE[contact.userLang] || SPEND_DROP_MESSAGE.EN)(anomaly.avg, anomaly.today, latestDate);
          const explanation = await generateAlertExplanation(
            contact.userLang,
            `Meta Ads daily spend dropped to $${Math.round(anomaly.today)} on ${latestDate}, versus a 7-day average of $${Math.round(anomaly.avg)}/day — this usually means a campaign was paused, disapproved, or a payment method failed.`
          );
          await sendAlertToBusiness(integ.business_id, contact, {
            type: "ad_spend_drop_meta_ads",
            severity: "high",
            message: msg,
            aiExplanation: explanation,
          });
        }

        const cacAnomaly = await detectCacAnomaly({ businessId: integ.business_id, date: latestDate, sensitivityMultiplier });
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

      const contact = await getUserContact(await getBusinessUserId(integ.business_id));
      const msg = (SYNC_FAILURE_MESSAGE[contact.userLang] || SYNC_FAILURE_MESSAGE.EN)();
      const explanation = await generateAlertExplanation(
        contact.userLang,
        `The Meta Ads integration was previously connected and syncing successfully. It just failed with this error: "${err.message}". This usually means the access token expired or lost the ads_read permission.`
      );
      await sendAlertToBusiness(integ.business_id, contact, {
        type: "sync_failure_meta_ads",
        severity: "high",
        message: msg,
        aiExplanation: explanation,
      });
    }
  }
}

export async function runSync(businessId, options = {}) {
  await main(businessId, options);
  return { synced: true, timestamp: new Date().toISOString() };
}
