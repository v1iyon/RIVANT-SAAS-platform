import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { logError } from "../lib/log-error.js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function getKey() {
  return crypto.createHash("sha256").update(process.env.ENCRYPTION_KEY || "").digest();
}

function decrypt(payload) {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

async function sendTelegram(chatId, text) {
  if (!chatId) return;
  await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function sendEmail(to, subject, text) {
  if (!to) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "RIVANT <onboarding@resend.dev>",
      to,
      subject,
      text,
    }),
  });
}

const PROMPTS = {
  UA: (b, t, y) => `Ти фінансовий аналітик. Дані бізнесу "${b.name}":
Сьогодні: виручка $${t.revenue}, витрати $${t.cost}, маржа ${t.margin_pct}%
Вчора: виручка $${y.revenue}, витрати $${y.cost}, маржа ${y.margin_pct}%
Одним реченням (до 25 слів), українською, поясни ймовірну причину зміни та що перевірити. Без вступних фраз.`,

  EN: (b, t, y) => `You are a financial analyst. Data for business "${b.name}":
Today: revenue $${t.revenue}, costs $${t.cost}, margin ${t.margin_pct}%
Yesterday: revenue $${y.revenue}, costs $${y.cost}, margin ${y.margin_pct}%
In one sentence (max 25 words), in English, explain the likely reason for the change and what to check. No intro phrases.`,

  DE: (b, t, y) => `Du bist Finanzanalyst. Daten für Unternehmen "${b.name}":
Heute: Umsatz $${t.revenue}, Kosten $${t.cost}, Marge ${t.margin_pct}%
Gestern: Umsatz $${y.revenue}, Kosten $${y.cost}, Marge ${y.margin_pct}%
In einem Satz (max. 25 Wörter), auf Deutsch, erkläre die wahrscheinliche Ursache und was zu prüfen ist. Keine Einleitung.`,
};

async function getAIExplanation(business, today, yesterday, language = "EN") {
  try {
    const buildPrompt = PROMPTS[language] || PROMPTS.EN;
    const prompt = buildPrompt(business, today, yesterday);

   const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 150,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
    const data = await res.json();
    return data.content?.[0]?.text?.trim() || null;
  } catch (err) {
    console.error("AI explanation failed:", err.message);
    return null;
  }
}

async function fetchStripeCharges(apiKey, sinceUnix) {
  const url = `https://api.stripe.com/v1/charges?created[gte]=${sinceUnix}&limit=100`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`Stripe error: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

async function main() {
  const { data: integrations, error: fetchErr } = await admin
    .from("integrations")
    .select("id, business_id, api_key_encrypted")
    .eq("provider", "stripe")
    .eq("status", "connected");

  console.log("DEBUG fetchErr:", fetchErr);
  console.log("DEBUG integrations found:", integrations?.length, JSON.stringify(integrations?.map(i => i.id)));

  if (!integrations?.length) {
    console.log("No connected Stripe integrations, nothing to sync.");
    return;
  }

  for (const integ of integrations) {
    try {
      console.log("DEBUG processing integration:", integ.id, "business_id:", integ.business_id);
      const apiKey = decrypt(integ.api_key_encrypted);
      console.log("DEBUG decrypt OK, key prefix:", apiKey?.slice(0, 8));
      const sinceUnix = Math.floor(Date.now() / 1000) - 48 * 3600;
      const charges = await fetchStripeCharges(apiKey, sinceUnix);
      console.log("DEBUG charges fetched:", charges.length);
      const successful = charges.filter((c) => c.paid && !c.refunded);
      console.log("DEBUG successful charges:", successful.length);

      const byDate = {};
      for (const c of successful) {
        const date = new Date(c.created * 1000).toISOString().slice(0, 10);
        if (!byDate[date]) byDate[date] = { revenue: 0, orders: 0 };
        byDate[date].revenue += c.amount / 100;
        byDate[date].orders += 1;
      }

      const { data: business, error: bizErr } = await admin
        .from("businesses")
        .select("id, user_id, name, cost_pct")
        .eq("id", integ.business_id)
        .maybeSingle();
      console.log("DEBUG business lookup for", integ.business_id, "-> found:", !!business, "error:", bizErr);
      if (!business) continue;

      const costPct = Number(business.cost_pct) || 30;
      console.log("DEBUG byDate:", JSON.stringify(byDate));

      for (const [date, agg] of Object.entries(byDate)) {
        const prevDate = new Date(new Date(date).getTime() - 24 * 3600 * 1000)
          .toISOString()
          .slice(0, 10);

        const { data: prev } = await admin
          .from("metrics_computed")
          .select("revenue, cost, margin_pct")
          .eq("business_id", business.id)
          .eq("date", prevDate)
          .maybeSingle();

        const cost = Number((agg.revenue * (costPct / 100)).toFixed(2));
        const marginPct = agg.revenue > 0
          ? Number((((agg.revenue - cost) / agg.revenue) * 100).toFixed(1))
          : 0;

        const { error: upsertErr } = await admin.from("metrics_computed").upsert(
          {
            business_id: business.id,
            date,
            revenue: agg.revenue,
            cost,
            margin_pct: marginPct,
            orders: agg.orders,
          },
          { onConflict: "business_id,date" }
        );
        console.log("DEBUG upsert result for", date, "error:", upsertErr);

        if (prev && prev.revenue > 0) {
          const change = ((agg.revenue - prev.revenue) / prev.revenue) * 100;
          if (change <= -20) {
            const message = `Revenue for ${business.name} dropped ${Math.abs(change).toFixed(0)}% on ${date}`;

            const { data: existingAlert } = await admin
              .from("alerts_log")
              .select("id")
              .eq("business_id", business.id)
              .eq("message", message)
              .maybeSingle();
            if (existingAlert) continue;

            const { data: user } = await admin
              .from("users")
              .select("telegram_id, email, email_enabled, language")
              .eq("id", business.user_id)
              .maybeSingle();

            const userLang = user?.language || "EN";

            const aiExplanation = await getAIExplanation(
              business,
              { revenue: agg.revenue, cost, margin_pct: marginPct },
              { revenue: prev.revenue, cost: prev.cost, margin_pct: prev.margin_pct },
              userLang
            );

            const { error: alertErr } = await admin.from("alerts_log").insert({
              business_id: business.id,
              type: "revenue_drop",
              message,
              ai_explanation: aiExplanation,
              status: "open",
            });
            console.log("DEBUG alerts_log insert error:", alertErr);

            const fullMessage = aiExplanation ? `⚠️ ${message}\n\n${aiExplanation}` : `⚠️ ${message}`;

            if (user?.telegram_id) {
              await sendTelegram(user.telegram_id, fullMessage);
            }
            if (user?.email_enabled && user?.email) {
              await sendEmail(user.email, "RIVANT Alert", fullMessage);
            }
          }
        }
      }

      await admin
        .from("integrations")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", integ.id);

      console.log(`Synced business ${business.id}: ${Object.keys(byDate).length} day(s) updated`);
    } catch (err) {
      console.error(`Failed to sync integration ${integ.id}:`, err.message);
      await logError({
        source: "stripe",
        message: `Sync failed for integration ${integ.id}`,
        details: err.message,
        businessId: integ.business_id,
      });
    }
  }
}

export async function runSync() {
  await main();
  return { synced: true, timestamp: new Date().toISOString() };
}