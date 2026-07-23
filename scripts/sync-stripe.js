const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

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

async function fetchStripeCharges(apiKey, sinceUnix) {
  const url = `https://api.stripe.com/v1/charges?created[gte]=${sinceUnix}&limit=100`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`Stripe error: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

async function main() {
  const { data: integrations } = await admin
    .from("integrations")
    .select("id, business_id, api_key_encrypted")
    .eq("provider", "stripe")
    .eq("status", "connected");

  if (!integrations?.length) {
    console.log("No connected Stripe integrations, nothing to sync.");
    return;
  }

  for (const integ of integrations) {
    try {
      const apiKey = decrypt(integ.api_key_encrypted);
      const sinceUnix = Math.floor(Date.now() / 1000) - 48 * 3600; // последние 48 часов с запасом
      const charges = await fetchStripeCharges(apiKey, sinceUnix);
      const successful = charges.filter((c) => c.paid && !c.refunded);

      // Группируем по дате (UTC)
      const byDate = {};
      for (const c of successful) {
        const date = new Date(c.created * 1000).toISOString().slice(0, 10);
        if (!byDate[date]) byDate[date] = { revenue: 0, orders: 0 };
        byDate[date].revenue += c.amount / 100;
        byDate[date].orders += 1;
      }

      const { data: business } = await admin
        .from("businesses")
        .select("id, user_id, name")
        .eq("id", integ.business_id)
        .maybeSingle();
      if (!business) continue;

      for (const [date, agg] of Object.entries(byDate)) {
        const { data: prev } = await admin
          .from("metrics_computed")
          .select("revenue")
          .eq("business_id", business.id)
          .eq("date", date)
          .maybeSingle();

        await admin.from("metrics_computed").upsert(
          {
            business_id: business.id,
            date,
            revenue: agg.revenue,
            cost: 0, // себестоимость пока не считаем автоматически из Stripe
            margin_pct: 0,
            orders: agg.orders,
          },
          { onConflict: "business_id,date" }
        );

        // Простая проверка отклонения: если выручка упала более чем на 20% относительно уже сохранённой
        if (prev && prev.revenue > 0) {
          const change = ((agg.revenue - prev.revenue) / prev.revenue) * 100;
          if (change <= -20) {
            const message = `Revenue for ${business.name} dropped ${Math.abs(change).toFixed(0)}% on ${date}`;
            await admin.from("alerts_log").insert({
              business_id: business.id,
              type: "revenue_drop",
              message,
              status: "open",
            });

            const { data: user } = await admin
              .from("users")
              .select("telegram_id, email, email_enabled")
              .eq("id", business.user_id)
              .maybeSingle();

            if (user?.telegram_id) {
              await sendTelegram(user.telegram_id, `⚠️ ${message}`);
            }
            if (user?.email_enabled && user?.email) {
              await sendEmail(user.email, "RIVANT Alert", message);
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
    }
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});