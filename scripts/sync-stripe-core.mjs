import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../lib/crypto.js";
import { logError } from "../lib/log-error.js";
import { getSeverityTelegramLabel } from "../lib/severity.js";
import { getTeamContacts } from "../lib/alerts.mjs";

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
  UA: (b, t, y, changePct) => `Дані бізнесу "${b.name}":
За останні 24 години: виручка $${t.revenue}, витрати $${t.cost}, маржа ${t.margin_pct}%
За попередні 24 години: виручка $${y.revenue}, витрати $${y.cost}, маржа ${y.margin_pct}%
Напиши ОДНЕ речення (до 30 слів) українською, професійним діловим тоном, без розмовних слів типу "тож" чи "отже". Формат:
"[Назва показника] [зросла/впала] на ${Math.abs(changePct).toFixed(0)}% за останні 24 години (з $${y.revenue} до $${t.revenue}), маржа [не змінилась / знизилась / зросла] і становить ${t.margin_pct}%. Перевірте: [2-3 конкретні пункти, релевантні саме цій проблемі]."
Відповідай ЛИШЕ цим реченням, без лапок і пояснень.`,

  EN: (b, t, y, changePct) => `Data for business "${b.name}":
Last 24 hours: revenue $${t.revenue}, costs $${t.cost}, margin ${t.margin_pct}%
Previous 24 hours: revenue $${y.revenue}, costs $${y.cost}, margin ${y.margin_pct}%
Write ONE sentence (max 30 words) in English, professional business tone, no filler words. Format:
"[Metric name] [dropped/rose] ${Math.abs(changePct).toFixed(0)}% over the last 24 hours (from $${y.revenue} to $${t.revenue}), margin [unchanged/lower/higher] at ${t.margin_pct}%. Check: [2-3 specific items relevant to this issue]."
Reply ONLY with this sentence, no quotes or explanations.`,

  DE: (b, t, y, changePct) => `Daten für "${b.name}":
Letzte 24 Stunden: Umsatz $${t.revenue}, Kosten $${t.cost}, Marge ${t.margin_pct}%
Vorherige 24 Stunden: Umsatz $${y.revenue}, Kosten $${y.cost}, Marge ${y.margin_pct}%
Schreibe EINEN Satz (max. 30 Wörter) auf Deutsch, professioneller Geschäftston, keine Füllwörter. Format:
"[Kennzahl] [gesunken/gestiegen] um ${Math.abs(changePct).toFixed(0)}% in den letzten 24 Stunden (von $${y.revenue} auf $${t.revenue}), Marge [unverändert/niedriger/höher] bei ${t.margin_pct}%. Prüfen Sie: [2-3 konkrete Punkte]."
Antworte NUR mit diesem Satz, ohne Anführungszeichen oder Erklärungen.`,
};

const REVENUE_DROP_MESSAGE = {
  UA: (name, pct) => `Виручка "${name}" впала на ${pct}% за останні 24 години`,
  EN: (name, pct) => `Revenue for ${name} dropped ${pct}% over the last 24 hours`,
  DE: (name, pct) => `Umsatz von ${name} ist in den letzten 24 Stunden um ${pct}% gesunken`,
};

// Резервне (не-AI) пояснення — використовується, коли Anthropic API
// недоступний/впав. Раніше в такому випадку getAIExplanation повертав null,
// і користувач бачив ЛИШЕ факт падіння виручки, без жодного пояснення чи
// підказки "що перевірити" — саме це і було зламано. Тепер пояснення
// показується ЗАВЖДИ: або від AI, або цей детермінований текст з тими самими
// цифрами і форматом, що і в промпті вище. Дедуп на 24 години (нижче за
// текстом, existingAlerts) не чіпаємо — він і так не дає слати одне й те ж
// повідомлення повторно, це окремий, вже робочий механізм.
function buildFallbackExplanation(language, today, yesterday, changePct) {
  const marginDelta = Number(today.margin_pct) - Number(yesterday.margin_pct);
  const direction = changePct < 0 ? { UA: "впала", EN: "dropped", DE: "gesunken" } : { UA: "зросла", EN: "rose", DE: "gestiegen" };
  const marginWord = {
    UA: Math.abs(marginDelta) < 1 ? "не змінилась" : marginDelta < 0 ? "знизилась" : "зросла",
    EN: Math.abs(marginDelta) < 1 ? "unchanged" : marginDelta < 0 ? "lower" : "higher",
    DE: Math.abs(marginDelta) < 1 ? "unverändert" : marginDelta < 0 ? "niedriger" : "höher",
  };
  const checkList = {
    UA: "Перевірте: чи не було збою рекламних кампаній, чи не змінились ціни/асортимент, чи всі інтеграції синхронізуються без помилок.",
    EN: "Check: any ad campaign outage, pricing/catalog changes, and whether all integrations are syncing without errors.",
    DE: "Prüfen Sie: Werbekampagnen-Ausfälle, Preis-/Sortimentsänderungen und ob alle Integrationen fehlerfrei synchronisieren.",
  };
  const templates = {
    UA: `Виручка ${direction.UA} на ${Math.abs(changePct).toFixed(0)}% за останні 24 години (з $${yesterday.revenue} до $${today.revenue}), маржа ${marginWord.UA} і становить ${today.margin_pct}%. ${checkList.UA}`,
    EN: `Revenue ${direction.EN} ${Math.abs(changePct).toFixed(0)}% over the last 24 hours (from $${yesterday.revenue} to $${today.revenue}), margin ${marginWord.EN} at ${today.margin_pct}%. ${checkList.EN}`,
    DE: `Der Umsatz ist in den letzten 24 Stunden um ${Math.abs(changePct).toFixed(0)}% ${direction.DE} (von $${yesterday.revenue} auf $${today.revenue}), die Marge ist ${marginWord.DE} bei ${today.margin_pct}%. ${checkList.DE}`,
  };
  return templates[language] || templates.EN;
}

async function getAIExplanation(business, today, yesterday, language = "EN", changePct) {
  const buildPrompt = PROMPTS[language] || PROMPTS.EN;
  const prompt = buildPrompt(business, today, yesterday, changePct);
  const fallback = () => buildFallbackExplanation(language, today, yesterday, changePct);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
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

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Anthropic API error: ${res.status} — ${errBody}`);
      }
      const data = await res.json();
      return data.content?.[0]?.text?.trim() || fallback();
    } catch (err) {
      console.error(`AI explanation failed (attempt ${attempt}/2):`, err.message);
      if (attempt === 2) {
        await logError({
          source: "ai_explanation",
          message: err.message,
          businessId: business.id,
        });
        return fallback();
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return fallback();
}

async function fetchStripeCharges(apiKey, sinceUnix) {
  // Раньше запрашивалась ровно одна страница (limit=100) — этого хватало,
  // пока окно было фиксированные 48ч. Теперь окно может расширяться назад
  // при бэкфилле пропущенных дней (см. вызов ниже), а значит charges может
  // быть больше 100 — добавлена пагинация по Stripe starting_after, чтобы
  // бэкфилл не обрезал старые дни молча.
  let all = [];
  let startingAfter = null;
  for (let page = 0; page < 20; page++) {
    // максимум 20 страниц (2000 charges) — защита от бесконечного цикла
    const params = new URLSearchParams({
      "created[gte]": String(sinceUnix),
      limit: "100",
    });
    params.append("expand[]", "data.balance_transaction");
    if (startingAfter) params.set("starting_after", startingAfter);

    const res = await fetch(`https://api.stripe.com/v1/charges?${params.toString()}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`Stripe error: ${res.status}`);
    const data = await res.json();
    const pageData = data.data || [];
    all = all.concat(pageData);
    if (!data.has_more || pageData.length === 0) break;
    startingAfter = pageData[pageData.length - 1].id;
  }
  return all;
}

async function main(businessId) {
  let query = admin
    .from("integrations")
    .select("id, business_id, api_key_encrypted")
    .eq("provider", "stripe")
    .eq("status", "connected");
  if (businessId) query = query.eq("business_id", businessId);
  const { data: integrations, error: fetchErr } = await query;

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

      // Самолечение пропущенных дней: крон гоняется раз в сутки (vercel.json),
      // и если конкретный прогон падает (таймаут Stripe, сбой decrypt и т.п.),
      // try/catch внизу это ловит и логирует в error_logs — но строка за тот
      // день в metrics_computed так и не появляется. Раньше окно запроса к
      // Stripe было жёстко 48ч, поэтому такой пропуск уже никогда не
      // подтягивался обратно, и "N дней данных" на вкладке Прогноз навсегда
      // отставало от реального возраста аккаунта. Здесь смотрим на пропуски
      // в metrics_computed за последние 30 дней (не раньше самой первой
      // известной даты — это просто означает "аккаунту меньше N дней", а не
      // пропуск) и, если они есть, расширяем окно синка к Stripe так, чтобы
      // захватить самый ранний пропущенный день.
      let sinceUnix = Math.floor(Date.now() / 1000) - 48 * 3600;
      const { data: existingDatesRows } = await admin
        .from("metrics_computed")
        .select("date")
        .eq("business_id", integ.business_id)
        .gte("date", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10))
        .order("date", { ascending: true });
      const existingDateSet = new Set((existingDatesRows || []).map((r) => r.date));
      if (existingDateSet.size > 0) {
        const earliestKnown = [...existingDateSet][0];
        for (let i = 2; i < 30; i++) {
          const d = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
          if (d < earliestKnown) break;
          if (!existingDateSet.has(d)) {
            const gapUnix = Math.floor(new Date(`${d}T00:00:00Z`).getTime() / 1000);
            sinceUnix = Math.min(sinceUnix, gapUnix);
            console.log("DEBUG gap day detected, widening sync window to backfill:", d);
          }
        }
      }

      const charges = await fetchStripeCharges(apiKey, sinceUnix);
      console.log("DEBUG charges fetched:", charges.length);
      const successful = charges.filter((c) => c.paid && !c.refunded);
      console.log("DEBUG successful charges:", successful.length);

      const byDate = {};
      for (const c of successful) {
        const date = new Date(c.created * 1000).toISOString().slice(0, 10);
        if (!byDate[date]) byDate[date] = { revenue: 0, orders: 0, stripeFee: 0 };
        byDate[date].revenue += c.amount / 100;
        byDate[date].orders += 1;
        // c.balance_transaction expanded above; может быть null, если ещё не заселилось (pending)
        const feeCents = c.balance_transaction?.fee ?? 0;
        byDate[date].stripeFee += feeCents / 100;
      }

      // ФИКС ложных "выручка упала до $0": revenue_drop раньше сравнивал
      // agg.revenue КАЛЕНДАРНОГО "сегодня" (растёт с $0 с полуночи и так
      // весь день) с ПОЛНОЙ выручкой за вчера из metrics_computed. Синк
      // гоняется раз в час (.github/workflows/sync-stripe.yml) — то есть
      // каждую ночь в 00:xx это давало "упало со вчерашних $2392 до $0",
      // в 01:xx — "до $150", и так по кругу, пока сегодняшний день не
      // догонит вчерашний. Это не аномалия, это устройство календаря.
      // Вместо "сегодня vs вчера" считаем СКОЛЬЗЯЩЕЕ окно "последние 24ч"
      // vs "предыдущие 24ч" прямо по timestamp'ам charges — оба окна
      // всегда одинаковой длины, поэтому полночь их не сбивает, и сигнал
      // остаётся live (не ждём конца дня).
      function sumChargesWindow(fromSec, toSec) {
        let revenue = 0, orders = 0, stripeFee = 0;
        for (const c of successful) {
          if (c.created >= fromSec && c.created < toSec) {
            revenue += c.amount / 100;
            orders += 1;
            stripeFee += (c.balance_transaction?.fee ?? 0) / 100;
          }
        }
        return { revenue: Number(revenue.toFixed(2)), orders, stripeFee: Number(stripeFee.toFixed(2)) };
      }
      const nowSec = Math.floor(Date.now() / 1000);
      const last24h = sumChargesWindow(nowSec - 24 * 3600, nowSec + 1);
      const prev24h = sumChargesWindow(nowSec - 48 * 3600, nowSec - 24 * 3600);

      // ВАЖНО: раньше, если за день не было ни одного успешного списания,
      // дата вообще не попадала в byDate — а значит для неё никогда не
      // создавалась строка в metrics_computed. Столбик в графике на фронте
      // просто исчезал, из-за чего дни с оплатами "склеивались" друг с
      // другом и создавали ложное впечатление непрерывного роста. Явно
      // добавляем в byDate КАЖДУЮ дату из фактически покрытого окна синка
      // (не только сегодня/вчера — окно может быть расширено бэкфиллом
      // пропущенных дней выше) с нулевой выручкой, если её там ещё нет —
      // реальный $0-день теперь тоже пишется в базу и попадает в
      // график/прогноз/бота.
      const todayStr = new Date().toISOString().slice(0, 10);
      for (let t = sinceUnix; t <= Math.floor(Date.now() / 1000); t += 24 * 3600) {
        const d = new Date(t * 1000).toISOString().slice(0, 10);
        if (!byDate[d]) byDate[d] = { revenue: 0, orders: 0, stripeFee: 0 };
      }
      if (!byDate[todayStr]) byDate[todayStr] = { revenue: 0, orders: 0, stripeFee: 0 };

      const { data: business, error: bizErr } = await admin
        .from("businesses")
        .select("id, user_id, name, cost_pct")
        .eq("id", integ.business_id)
        .maybeSingle();
      console.log("DEBUG business lookup for", integ.business_id, "-> found:", !!business, "error:", bizErr);
      if (!business) continue;

      if (!business) continue;

      // Не обновляем метрики, если подписка не активна (трайл/план закончился)
      const { data: subRow } = await admin
        .from("subscriptions")
        .select("access_status, current_period_end")
        .eq("user_id", business.user_id)
        .maybeSingle();

      const periodEnded = subRow?.current_period_end
        ? new Date(subRow.current_period_end) < new Date()
        : false;

      const subscriptionInactive =
        !subRow ||
        subRow.access_status === "blocked" ||
        subRow.access_status === "none" ||
        periodEnded;

      if (subscriptionInactive) {
        console.log(`Skipping sync for business ${business.id}: subscription inactive`);
        continue;
      }

      // Если Shopify подключён — реальная себестоимость товара уже пишется
      // в expenses (shopify-sync.mjs, category "cogs") и подмешивается в
      // /api/metrics. Оценку cost_pct в этом случае НЕ применяем, иначе
      // себестоимость посчитается дважды (выдуманный % + реальные цифры).
      const { data: shopifyIntegration } = await admin
        .from("integrations")
        .select("status")
        .eq("business_id", business.id)
        .eq("provider", "shopify")
        .maybeSingle();
      const shopifyConnected = shopifyIntegration?.status === "connected";

      const costPct = shopifyConnected ? 0 : Number(business.cost_pct) || 30;
      console.log("DEBUG byDate:", JSON.stringify(byDate), "shopifyConnected:", shopifyConnected);

      // ВАЖНО (фикс спама уведомлений): sinceUnix = now - 48h, поэтому byDate
      // почти всегда содержит ДВЕ даты — вчера и сегодня. Раньше alert-логика
      // (auto-resolve/dedup/insert) прогонялась для КАЖДОЙ даты в цикле. Из-за
      // этого на каждом часовом синке "вчера" (уже полностью прошедший, обычно
      // стабильный день) пересчитывался заново и его change>-20 срабатывал
      // auto-resolve — который резолвит ВСЕ open алерты типа revenue_drop для
      // бизнеса, включая тот, что только что создан для "сегодня". На следующем
      // прогоне dedup уже не находил open-алерт (он был resolved минуту назад)
      // и создавал новый — отсюда алерт каждый час вместо одного раза в 24ч, и
      // Risks tab всегда пустой (алерт resolved раньше, чем человек откроет
      // кабинет). Теперь alert-логика гоняется только для САМОЙ ПОЗДНЕЙ даты —
      // остальные даты по-прежнему обновляют metrics_computed, но не трогают
      // alerts_log.
      const latestDate = Object.keys(byDate).sort().pop();

      // Тянет реальные расходы (advertising/shipping/cogs — все категории,
      // как в /api/metrics) за конкретную дату и пересчитывает маржу с их
      // учётом. Раньше в Telegram/AI-алерт улетала margin_pct прямо из
      // metrics_computed — она считалась ТОЛЬКО из Stripe-комиссии/COGS-оценки,
      // без учёта Shopify shipping и рекламных расходов, поэтому бот показывал
      // другую маржу (66.8%), чем кабинет (47%, с учётом всех расходов).
      async function getFullMargin(businessId, forDate, revenue, baseCost) {
        const { data: expenseRows } = await admin
          .from("expenses")
          .select("amount")
          .eq("business_id", businessId)
          .eq("date", forDate);
        const extraTotal = (expenseRows || []).reduce((s, r) => s + Number(r.amount), 0);
        const fullCost = Number((baseCost + extraTotal).toFixed(2));
        const marginPct = revenue > 0 ? Number((((revenue - fullCost) / revenue) * 100).toFixed(1)) : 0;
        return { fullCost, marginPct };
      }

      for (const [date, agg] of Object.entries(byDate)) {
        const prevDate = new Date(new Date(date).getTime() - 24 * 3600 * 1000)
          .toISOString()
          .slice(0, 10);

        const cogsCost = agg.revenue * (costPct / 100);
        const stripeFee = agg.stripeFee || 0;
        const cost = Number((cogsCost + stripeFee).toFixed(2));
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

        if (date !== latestDate) continue; // см. комментарий про фикс спама выше

        {
          const last24hCogsCost = Number((last24h.revenue * (costPct / 100)).toFixed(2));
          const last24hCost = Number((last24hCogsCost + last24h.stripeFee).toFixed(2));
          const prev24hCogsCost = Number((prev24h.revenue * (costPct / 100)).toFixed(2));
          const prev24hCost = Number((prev24hCogsCost + prev24h.stripeFee).toFixed(2));

          const change = prev24h.revenue > 0
            ? ((last24h.revenue - prev24h.revenue) / prev24h.revenue) * 100
            : (last24h.revenue > 0 ? 100 : 0); // с нуля восстановились = рост, всё ещё 0 = без изменений (не новый алерт)

          // Игнорируем колебания на копеечных суммах: $5 -> $0 формально
          // "-100%", но для реального бизнеса это шум, а не сигнал. Порог
          // применяется к ПРЕДЫДУЩЕМУ окну — если там уже было мало денег,
          // относительный % ничего не значит.
          const MIN_REVENUE_FOR_ALERT = 20;
          const tooSmallToMatter = prev24h.revenue < MIN_REVENUE_FOR_ALERT;

          if (change > -20 || tooSmallToMatter) {
            const { data: resolved, error: resolveErr } = await admin
              .from("alerts_log")
              .update({ status: "resolved" })
              .eq("business_id", business.id)
              .eq("type", "revenue_drop")
              .eq("status", "open")
              .select("id");
            console.log("DEBUG auto-resolved alerts:", resolved?.length, "error:", resolveErr);
          }

          if (change <= -20 && !tooSmallToMatter) {
            const severity = change <= -50 ? "critical" : change <= -35 ? "high" : "medium";

            const { data: user } = await admin
              .from("users")
              .select("telegram_id, email, email_enabled, push_enabled, language")
              .eq("id", business.user_id)
              .maybeSingle();

            const userLang = user?.language || "EN";
            const buildMessage = REVENUE_DROP_MESSAGE[userLang] || REVENUE_DROP_MESSAGE.EN;
            const message = buildMessage(business.name, Math.abs(change).toFixed(0));

           const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const { data: existingAlerts, error: dedupErr } = await admin
  .from("alerts_log")
  .select("id, sent_at")
  .eq("business_id", business.id)
  .eq("type", "revenue_drop")
  .eq("status", "open")
  .gte("sent_at", oneDayAgo)
  .order("sent_at", { ascending: false })
  .limit(1);

console.log("DEBUG dedup check:", existingAlerts?.length, "error:", dedupErr);
if (existingAlerts?.length) continue;

            const { marginPct: todayFullMargin, fullCost: todayFullCost } = await getFullMargin(
              business.id, date, last24h.revenue, last24hCost
            );
            const { marginPct: prevFullMargin, fullCost: prevFullCost } = await getFullMargin(
              business.id, prevDate, prev24h.revenue, prev24hCost
            );

            const aiExplanation = await getAIExplanation(
              business,
              { revenue: last24h.revenue, cost: todayFullCost, margin_pct: todayFullMargin },
              { revenue: prev24h.revenue, cost: prevFullCost, margin_pct: prevFullMargin },
              userLang,
              change
            );

            const { error: alertErr } = await admin.from("alerts_log").insert({
              business_id: business.id,
              type: "revenue_drop",
              message,
              ai_explanation: aiExplanation,
              status: "open",
              severity,
              sent_at: new Date().toISOString(),
            });
            console.log("DEBUG alerts_log insert error:", alertErr);

            const severityLabel = getSeverityTelegramLabel(severity, userLang);

            const fullMessage = aiExplanation
              ? `${severityLabel}\n${message}\n\n${aiExplanation}`
              : `${severityLabel}\n${message}`;

            // push_enabled раньше не проверялся здесь вовсе (см. тот же фикс
            // в lib/alerts.mjs) — тумблер уведомлений в кабинете ни на что не
            // влиял для этого конкретного алерта (revenue_drop).
            if (user?.telegram_id && user?.push_enabled !== false) {
              await sendTelegram(user.telegram_id, fullMessage);
            }
            if (user?.email_enabled && user?.email) {
              await sendEmail(user.email, "RIVANT Alert", fullMessage);

            }

            // Допуслуга "Сповіщення для команди" — раньше эта функция вообще
            // не вызывалась ни для одного алерта (см. lib/alerts.mjs), из-за
            // чего подключившие её не получали ничего. revenue_drop — самый
            // частый тип алерта (Stripe-синк раз в день), поэтому фан-аут
            // добавлен именно сюда, а не только в Shopify/Meta/Google Ads.
            const teamIds = await getTeamContacts(business.id);
            if (teamIds.length) {
              await Promise.all(teamIds.map((chatId) => sendTelegram(chatId, fullMessage)));
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

export async function runSync(businessId) {
  await main(businessId);
  return { synced: true, timestamp: new Date().toISOString() };
}