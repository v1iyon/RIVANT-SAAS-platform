// app/api/cron/process-service-orders/route.js
// Запускать раз в 2-3 хвилини (див. vercel.json) — це і є той "результат за
// 5 хвилин без участі людини", про який йшлося: клієнт платить -> вебхук
// створює pending service_order -> цей крон його підхоплює й доставляє.

import { createClient } from "@supabase/supabase-js";
import { buildReport } from "../../../../lib/whatif-report.mjs";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

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
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "RIVANT Reports <onboarding@resend.dev>", to, subject, text }),
  });
}

function formatReportText(order, result) {
  const title = order.service_type === "whatif_analysis" ? "AI-Реконструкція минулого — 12 місяців" : "AI-Дайджест ефективності — 30 днів";
  const f = result.facts;
  const stats = [
    `Період: ${f.periodStart} — ${f.periodEnd}`,
    `Виручка за період: $${f.totalRevenue}`,
    `Замовлень: ${f.totalOrders}`,
    `Середня маржа: ${f.avgMarginPct}% (зміна за період: ${f.marginChangePct > 0 ? "+" : ""}${f.marginChangePct}%)`,
    f.topChannel ? `Найбільший канал витрат: ${f.topChannel.name} ($${f.topChannel.spend})` : null,
  ].filter(Boolean);

  return `📊 ${title}\n\n${stats.join("\n")}\n\n${result.narrative || ""}\n\nЦе факти на основі ваших даних, без рекомендацій — рішення за вами.`;
}

export async function GET(req) {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { data: orders } = await admin
    .from("service_orders")
    .select("*")
    .eq("status", "pending")
    .limit(20);

  if (!orders?.length) return Response.json({ processed: 0 });

  let processed = 0;
  for (const order of orders) {
    await admin.from("service_orders").update({ status: "processing" }).eq("id", order.id);

    try {
      const result = await buildReport(order.business_id, order.service_type);

      if (!result.ok) {
        // Недостатньо даних — не провал, а очікуваний стан: повідомляємо
        // клієнта чому звіт поки неможливий, замість тихого fail.
        await admin
          .from("service_orders")
          .update({ status: "failed", error_message: result.reason })
          .eq("id", order.id);

        const { data: user } = await admin.from("users").select("email, telegram_id").eq("id", order.user_id).maybeSingle();
        const msg = "Для цього звіту поки недостатньо даних (потрібно мінімум ~2 тижні історії). Ми повернемось до цього автоматично, коли даних стане достатньо, або зверніться в підтримку для повернення коштів.";
        if (user?.telegram_id) await sendTelegram(user.telegram_id, msg);
        if (user?.email) await sendEmail(user.email, "RIVANT: недостатньо даних для звіту", msg);
        continue;
      }

      const reportText = formatReportText(order, result);
      const { data: user } = await admin.from("users").select("email, telegram_id").eq("id", order.user_id).maybeSingle();

      if (user?.telegram_id) await sendTelegram(user.telegram_id, reportText);
      if (user?.email) await sendEmail(user.email, "Ваш звіт RIVANT готовий", reportText);

      await admin
        .from("service_orders")
        .update({ status: "delivered", delivered_at: new Date().toISOString(), report_summary: reportText.slice(0, 500) })
        .eq("id", order.id);

      processed++;
    } catch (err) {
      console.error("process-service-orders: order failed", order.id, err);
      await admin.from("service_orders").update({ status: "failed", error_message: String(err.message || err) }).eq("id", order.id);
    }
  }

  return Response.json({ processed });
}
