import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function sendTelegramToAll(message) {
  const { data: users } = await admin
    .from("users")
    .select("telegram_id, push_enabled")
    .not("telegram_id", "is", null);

  // Тот же принцип, что уже применён в lib/alerts.mjs (getUserContact):
  // push_enabled === false — явный отказ пользователя от уведомлений в
  // Telegram, и админ-рассылка не должна его обходить. undefined/true
  // остаются включёнными по умолчанию.
  const recipients = (users || []).filter((u) => u.push_enabled !== false);

  let sentCount = 0;
  for (const u of recipients) {
    try {
      await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: u.telegram_id, text: `📢 ${message}` }),
      });
      sentCount++;
    } catch (e) {
      console.error("Failed to send broadcast to", u.telegram_id, e.message);
    }
  }
  return sentCount;
}

export async function POST(req) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  const { message, viaTelegram, viaInApp, expireDays } = await req.json();
  if (!message || !message.trim()) {
    return Response.json({ error: "message required" }, { status: 400 });
  }
  if (!viaTelegram && !viaInApp) {
    return Response.json({ error: "choose at least one channel" }, { status: 400 });
  }

  let telegramSentCount = 0;
  if (viaTelegram) {
    telegramSentCount = await sendTelegramToAll(message.trim());
  }

 const expiresAt = expireDays ? new Date(Date.now() + expireDays * 24 * 60 * 60 * 1000).toISOString() : null;

const { error } = await admin.from("broadcast_notifications").insert({
  message: message.trim(),
  sent_telegram: !!viaTelegram,
  sent_inapp: !!viaInApp,
  telegram_sent_count: telegramSentCount,
  expires_at: expiresAt,
});

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true, telegramSentCount });
}
