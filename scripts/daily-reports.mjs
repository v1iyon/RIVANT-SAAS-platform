// scripts/daily-reports.mjs
//
// Ранковий (08:00) і вечірній (20:00) звіти — за київським часом (DST
// врахований через Intl, без ручної математики зі зсувом). Запускається
// з того ж hourly-крону, що і решта синків (.github/workflows/sync-stripe.yml
// -> scripts/run-sync.mjs) — щогодини перевіряє поточну годину в Києві і
// один раз за добу шле потрібний тип звіту. Дедуп — власний запис у
// alerts_log (type: daily_digest_morning / daily_digest_evening), щоб
// повторний прогін в межах тієї ж години нічого не задублював.
//
// ВАЖЛИВО: це НЕ алерти про проблему — жодних порогів, жодного ризику
// хибних спрацьовувань. Просто факти: вчорашній/сьогоднішній дохід + чи є
// зараз відкриті сповіщення. "Миттєва тривога" про реальні проблеми — це
// revenue_drop (ковзне вікно 24г) і payment_silence_stripe (тиша по
// платежах), обидва в scripts/sync-stripe-core.mjs, і вони спрацьовують
// будь-якої миті доби/ночі, не чекаючи розкладу.

import { createClient } from "@supabase/supabase-js";
import { getUserContact, sendDailyReport } from "../lib/alerts.mjs";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function kyivHour() {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Kyiv", hour: "numeric", hour12: false }).format(new Date())
  );
}

function kyivDateStr() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date()); // YYYY-MM-DD
}

export async function runDailyReports() {
  const hour = kyivHour();
  const kind = hour === 8 ? "morning" : hour === 20 ? "evening" : null;
  if (!kind) return; // не наш час — тихо виходимо, чекаємо наступного прогону

  const digestType = kind === "morning" ? "daily_digest_morning" : "daily_digest_evening";
  const today = kyivDateStr();

  const { data: businesses } = await admin.from("businesses").select("id, user_id, name");
  if (!businesses?.length) return;

  for (const business of businesses) {
    try {
      // Дедуп: якщо цей звіт для цього бізнесу вже слали сьогодні — пропускаємо.
      const { data: already } = await admin
        .from("alerts_log")
        .select("id")
        .eq("business_id", business.id)
        .eq("type", digestType)
        .gte("sent_at", `${today}T00:00:00Z`)
        .limit(1);
      if (already?.length) continue;

      const contact = await getUserContact(business.user_id);
      if (!contact.telegramId && !(contact.emailEnabled && contact.email)) continue; // некому слати

      let revenue = 0, marginPct = 0, count = 0;

      if (kind === "morning") {
        // Вчорашній ПОВНИЙ день — останній рядок metrics_computed до сьогодні.
        const { data: yesterday } = await admin
          .from("metrics_computed")
          .select("revenue, margin_pct")
          .eq("business_id", business.id)
          .lt("date", today)
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle();
        revenue = yesterday?.revenue ?? 0;
        marginPct = yesterday?.margin_pct ?? 0;

        const { data: openAlerts } = await admin
          .from("alerts_log")
          .select("id")
          .eq("business_id", business.id)
          .eq("status", "open");
        count = openAlerts?.length || 0;
      } else {
        // Сьогоднішній день (ще накопичується) — саме те, що бачить власник у "Огляд".
        const { data: todayRow } = await admin
          .from("metrics_computed")
          .select("revenue, margin_pct")
          .eq("business_id", business.id)
          .eq("date", today)
          .maybeSingle();
        revenue = todayRow?.revenue ?? 0;
        marginPct = todayRow?.margin_pct ?? 0;

        const { data: newAlerts } = await admin
          .from("alerts_log")
          .select("id")
          .eq("business_id", business.id)
          .gte("sent_at", `${today}T00:00:00Z`)
          .not("type", "in", "(daily_digest_morning,daily_digest_evening)");
        count = newAlerts?.length || 0;
      }

      await sendDailyReport(business.id, business.name, contact, kind, { revenue, marginPct, count });

      await admin.from("alerts_log").insert({
        business_id: business.id,
        type: digestType,
        message: kind, // службова позначка "вже надіслано сьогодні", у Risks tab не показується (див. нижче)
        status: "resolved", // одразу resolved — це не проблема, яку треба "закривати" вручну
        severity: "low",
        sent_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`daily-reports (${kind}) failed for business ${business.id}:`, err.message);
    }
  }
}
