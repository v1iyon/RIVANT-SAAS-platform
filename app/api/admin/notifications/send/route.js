import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const LANGS = ["EN", "UA", "DE"];

// п. B6 аудита: раньше один общий text уходил всем на языке, на котором
// его написал админ — DE-клиент получал объявление на UA/EN. Теперь три
// текста, каждому пользователю уходит его users.language (или EN, если
// это поле у него почему-то не выставлено).
async function sendTelegramToAll(messages) {
  const { data: users } = await admin
    .from("users")
    .select("telegram_id, push_enabled, language")
    .not("telegram_id", "is", null);

  const recipients = (users || []).filter((u) => u.push_enabled !== false);

  let sentCount = 0;
  for (const u of recipients) {
    const lang = LANGS.includes(u.language) ? u.language : "EN";
    const text = messages[lang] || messages.EN;
    if (!text) continue;
    try {
      await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: u.telegram_id, text: `📢 ${text}` }),
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

  const { messages, viaTelegram, viaInApp, expireDays } = await req.json();

  const trimmed = {
    EN: (messages?.EN || "").trim(),
    UA: (messages?.UA || "").trim(),
    DE: (messages?.DE || "").trim(),
  };

  // Хотя бы один язык обязателен — остальные при отправке фолбэкнутся на EN,
  // но нужен хотя бы один непустой текст, иначе рассылка ни о чём.
  if (!trimmed.EN && !trimmed.UA && !trimmed.DE) {
    return Response.json({ error: "at least one language is required" }, { status: 400 });
  }
  if (!trimmed.EN) {
    return Response.json({ error: "English text is required as fallback for missing languages" }, { status: 400 });
  }
  if (!viaTelegram && !viaInApp) {
    return Response.json({ error: "choose at least one channel" }, { status: 400 });
  }

  let telegramSentCount = 0;
  if (viaTelegram) {
    telegramSentCount = await sendTelegramToAll(trimmed);
  }

  const expiresAt = expireDays ? new Date(Date.now() + expireDays * 24 * 60 * 60 * 1000).toISOString() : null;

  const { error } = await admin.from("broadcast_notifications").insert({
    // legacy-колонка — держим в синхроне для обратной совместимости,
    // пока не убедимся, что ничего кроме этого роута её не читает.
    message: trimmed.EN,
    message_en: trimmed.EN,
    message_ua: trimmed.UA || trimmed.EN,
    message_de: trimmed.DE || trimmed.EN,
    sent_telegram: !!viaTelegram,
    sent_inapp: !!viaInApp,
    telegram_sent_count: telegramSentCount,
    expires_at: expiresAt,
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true, telegramSentCount });
}