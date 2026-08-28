// app/api/cron/process-service-orders/route.js
//
// п.9 аудита: раньше этот роут не висел ни на каком расписании — только
// ручная кнопка в админке. Теперь дергается дважды в час из GitHub Actions
// (.github/workflows/sync-stripe.yml, тот же job, что и остальной синк) —
// клиент платит -> вебхук создаёт pending service_order -> этот крон
// подхватывает и доставляет, без ручного одобрения. Задержка доставки —
// до ~30 минут вместо "раз в 2-3 минуты", как было в комментарии ниже
// изначально (тот темп требовал бы Vercel Pro-крона — см. п.6/9 аудита);
// ~30 минут — приемлемый компромисс для отчёта, который и так генерируется
// не мгновенно.

import { createClient } from "@supabase/supabase-js";
import { isValidSecret } from "@/lib/verify-secret";
import { buildReport } from "../../../../lib/whatif-report.mjs";
import { renderServiceReportPdf } from "../../../../lib/service-report-pdf.mjs";

// НАЙДЕНО при повторном аудите: в отличие от /api/sync-now (maxDuration=60),
// этот роут вообще не объявлял maxDuration — а он последовательно рендерит
// PDF и шлёт Telegram/email. Теперь этот роут дергается автоматически из
// GitHub Actions (см. .github/workflows/sync-stripe.yml, п.9). Значение
// ниже — на будущее, если перейдёшь на Vercel Pro; на подтверждённом Hobby
// (см. п.6) оно ничего не меняет — жёсткий лимит 10с всё равно применяется
// первым. Основная защита от таймаута теперь не здесь, а в виде обработки
// по одному заказу за прогон + самоисцеления зависших "processing" — см.
// комментарий в начале GET() ниже.
export const maxDuration = 60;

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
  // Timing-safe сравнение секрета — см. lib/verify-secret.js и п. 2.5 аудита.
  const secret = req.headers.get("x-cron-secret");
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  const isVercelCron = isValidSecret(bearerToken, process.env.CRON_SECRET);
  if (!isValidSecret(secret, process.env.CRON_SECRET) && !isVercelCron) return Response.json({ error: "unauthorized" }, { status: 401 });

  // НАЙДЕНО при повторном аудите (после подтверждения, что план — Vercel
  // Hobby): maxDuration=60 выше ничего не даёт — на Hobby жёсткий лимит 10с
  // применяется независимо от объявленного значения (см. п.6 аудита). Раньше
  // это была теоретическая проблема ("могут не уложиться"), но теперь роут
  // дёргается автоматически каждые ~30 минут (см. sync-stripe.yml, п.9), а
  // не по ручному клику раз в сколько-то дней — риск стал регулярным.
  //
  // Реальная опасность — не просто таймаут одного прогона, а ОСИРОТЕВШИЕ
  // заказы: если платформа убьёт функцию посреди работы над заказом, он
  // остаётся в статусе "processing" НАВСЕГДА — таблица не имеет колонки
  // "когда начали processing", а select ниже фильтрует только "pending", то
  // есть "processing"-заказ больше никогда и никем не подхватывается и
  // отчёт клиенту не придёт, без какой-либо ошибки в логах.
  //
  // Фикс из двух частей:
  //  1) Самоисцеление: в начале каждого прогона возвращаем в "pending"
  //     любые заказы, всё ещё висящие в "processing" — раз прогоны не
  //     параллелятся (один cron tick = один вызов) и каждый прогон занимает
  //     не больше своего же таймаута, "processing"-заказ, доживший до
  //     СЛЕДУЮЩЕГО прогона, гарантированно осиротел, а не "ещё обрабатывается".
  //  2) Обрабатываем по ОДНОМУ заказу за прогон (было — до 20 подряд
  //     последовательно) — тот же принцип, что уже применён в
  //     backfill-historical, чтобы одна PDF-генерация + отправка укладывались
  //     в 10с с запасом, а не гарантированно ловили таймаут на 3-4 заказе
  //     очереди. При двух прогонах в час этого достаточно для текущего
  //     объёма (см. п.9 аудита — "объём небольшой").
  const { error: recoverErr } = await admin
    .from("service_orders")
    .update({ status: "pending" })
    .eq("status", "processing");
  if (recoverErr) {
    console.error("process-service-orders: failed to recover stuck 'processing' orders:", recoverErr.message);
  }

  const { data: orders } = await admin
    .from("service_orders")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);

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
        metrics: result.metrics,
        expensesBySource: result.expensesBySource,
        monthOverMonth: result.monthOverMonth,
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