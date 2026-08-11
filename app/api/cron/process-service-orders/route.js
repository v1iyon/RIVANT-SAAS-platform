// app/api/cron/process-service-orders/route.js
// Запускать раз в 2-3 хвилини (див. vercel.json) — це і є той "результат за
// 5 хвилин без участі людини", про який йшлося: клієнт платить -> вебхук
// створює pending service_order -> цей крон його підхоплює й доставляє.

import { createClient } from "@supabase/supabase-js";
import { buildReport } from "../../../../lib/whatif-report.mjs";
import { renderServiceReportPdf } from "../../../../lib/service-report-pdf.mjs";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function sendTelegram(chatId, text) {
  if (!chatId) return;
  await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

// sendDocument, на відміну від sendMessage, приймає multipart/form-data —
// файл треба покласти як Blob у FormData, а не в JSON-тіло.
async function sendTelegramDocument(chatId, buffer, filename, caption) {
  if (!chatId) return;
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption);
  form.append("document", new Blob([buffer], { type: "application/pdf" }), filename);
  await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendDocument`, {
    method: "POST",
    body: form,
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

async function sendEmailWithAttachment(to, subject, text, buffer, filename) {
  if (!to) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "RIVANT Reports <onboarding@resend.dev>",
      to,
      subject,
      text,
      attachments: [{ filename, content: buffer.toString("base64") }],
    }),
  });
}

const CAPTION = {
  UA: (title) => `📄 ${title} готовий — повний звіт у прикріпленому PDF.`,
  EN: (title) => `📄 ${title} is ready — full report in the attached PDF.`,
  DE: (title) => `📄 ${title} ist fertig — vollständiger Bericht im angehängten PDF.`,
};

function reportTitle(serviceType, language) {
  const titles = {
    whatif_analysis: { UA: "AI-Реконструкція минулого", EN: "AI Historical Reconstruction", DE: "KI-Rekonstruktion der Vergangenheit" },
    monthly_digest: { UA: "AI-Дайджест ефективності", EN: "AI Performance Digest", DE: "KI-Leistungs-Digest" },
  };
  return titles[serviceType]?.[language] || titles[serviceType]?.EN || "RIVANT Report";
}

export async function GET(req) {
  const secret = req.headers.get("x-cron-secret");
  const isVercelCron = req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  if (secret !== process.env.CRON_SECRET && !isVercelCron) return Response.json({ error: "unauthorized" }, { status: 401 });

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

      const reportTitleText = reportTitle(order.service_type, result.language);
      const { data: user } = await admin.from("users").select("email, telegram_id").eq("id", order.user_id).maybeSingle();
      const { data: business } = await admin.from("businesses").select("name").eq("id", order.business_id).maybeSingle();

      const { buffer, filename } = await renderServiceReportPdf({
        businessName: business?.name || "Business",
        serviceType: order.service_type,
        facts: result.facts,
        narrative: result.narrative,
        language: result.language,
      });
      const caption = (CAPTION[result.language] || CAPTION.EN)(reportTitleText);

      if (user?.telegram_id) await sendTelegramDocument(user.telegram_id, buffer, filename, caption);
      if (user?.email) await sendEmailWithAttachment(user.email, `RIVANT: ${reportTitleText}`, caption, buffer, filename);

      await admin
        .from("service_orders")
        .update({ status: "delivered", delivered_at: new Date().toISOString(), report_summary: caption })
        .eq("id", order.id);

      processed++;
    } catch (err) {
      console.error("process-service-orders: order failed", order.id, err);
      await admin.from("service_orders").update({ status: "failed", error_message: String(err.message || err) }).eq("id", order.id);
    }
  }

  return Response.json({ processed });
}
