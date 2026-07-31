import { createClient } from "@supabase/supabase-js";
import { InlineKeyboard } from "grammy";
import { getDict } from "../../../../src/i18n.js"; // поправь путь под свою структуру

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export async function GET(req) {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const in3Days = new Date(now.getTime() + 3 * 24 * 3600 * 1000).toISOString();
  const in2Days = new Date(now.getTime() + 2 * 24 * 3600 * 1000).toISOString();

  const { data: subs } = await admin
    .from("subscriptions")
    .select("user_id, current_period_end, plan")
    .eq("plan", "trial")
    .gte("current_period_end", in2Days)
    .lte("current_period_end", in3Days);

  if (!subs?.length) return Response.json({ sent: 0 });

  let sent = 0;
  for (const sub of subs) {
    // Уже отвечал (в любом канале) — пропускаем
    const { data: existing } = await admin
      .from("user_events")
      .select("id")
      .eq("user_id", sub.user_id)
      .in("event_type", ["trial_prompt_yes", "trial_prompt_no"])
      .maybeSingle();
    if (existing) continue;

    // Уже слали промпт недавно — не дублируем
    const { data: alreadySent } = await admin
      .from("user_events")
      .select("id")
      .eq("user_id", sub.user_id)
      .eq("event_type", "trial_prompt_sent")
      .maybeSingle();
    if (alreadySent) continue;

    const { data: user } = await admin
      .from("users")
      .select("telegram_id, email, language")
      .eq("id", sub.user_id)
      .maybeSingle();
    if (!user?.telegram_id) continue;

    const lang = user.language || "EN";
    const d = getDict(lang);
    const kb = new InlineKeyboard()
      .text(lang === "UA" ? "✅ Так, хочу продовжити" : "✅ Yes", "trial_yes")
      .text(lang === "UA" ? "❌ Поки ні" : "❌ Not now", "trial_no");

    const text = lang === "UA"
      ? "Ваш тестовий період закінчується через кілька днів. Хочете продовжити користуватися RIVANT?"
      : "Your trial ends in a few days. Would you like to continue using RIVANT?";

    await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: user.telegram_id, text, reply_markup: kb }),
    });

    await admin.from("user_events").insert({
      user_id: sub.user_id,
      event_type: "trial_prompt_sent",
      channel: "telegram",
    });
    sent++;
  }

  return Response.json({ sent });
}