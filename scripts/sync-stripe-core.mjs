import { createClient } from "@supabase/supabase-js";
import { decrypt } from "../lib/crypto.js";
import { logError } from "../lib/log-error.js";
import { sendAlertToBusiness, hasRecentAlert, resolveSensitivityMultiplier, getUserContact } from "../lib/alerts.mjs";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ЄДИНЕ джерело правди для "якому календарному дню бізнесу належить ця
// мить" — той самий підхід, що вже був у daily-reports.mjs (localDateStr)
// і в bot.js. РАНІШЕ byDate тут групувався по UTC-даті
// (new Date(c.created*1000).toISOString().slice(0,10)), а daily-reports.mjs
// і bot.js читають "сьогодні"/"вчора" по ЛОКАЛЬНІЙ даті бізнесу — для будь-
// якого не-UTC часового поясу (тобто майже всіх клієнтів) ці дві дати
// періодично розходились, і ранковий/вечірній дайджест чи бот могли
// підхопити не той рядок metrics_computed, що очікувалось.
function localDateStr(tz, atSec) {
  const d = atSec != null ? new Date(atSec * 1000) : new Date();
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC" }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(d);
  }
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

const SYNC_FAILURE_MESSAGE = {
  UA: () => `Не вдалося синхронізувати Stripe`,
  EN: () => `Failed to sync Stripe`,
  DE: () => `Stripe Synchronisierung fehlgeschlagen`,
};

function getSyncFailureReason(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("401") || message.includes("invalid api key") || message.includes("authentication")) return "access_denied";
  if (message.includes("429") || message.includes("rate limit")) return "rate_limited";
  if (message.includes("timeout") || message.includes("network")) return "connection_failed";
  return "connection_failed";
}

const SYNC_FAILURE_EXPLANATION = {
  UA: {
    access_denied: "Перевірте API-ключ Stripe у налаштуваннях інтеграції — можливо, він відкликаний або застарів.",
    rate_limited: "Stripe тимчасово обмежив кількість запитів — синхронізація відновиться на наступному прогоні.",
    connection_failed: "Тимчасова помилка з'єднання зі Stripe — перевірте статус інтеграції.",
  },
  EN: {
    access_denied: "Check the Stripe API key in integration settings — it may be revoked or expired.",
    rate_limited: "Stripe temporarily rate-limited requests — sync will resume on the next run.",
    connection_failed: "Temporary connection issue with Stripe — check the integration status.",
  },
  DE: {
    access_denied: "Prüfen Sie den Stripe-API-Schlüssel in den Integrationseinstellungen — er könnte widerrufen oder abgelaufen sein.",
    rate_limited: "Stripe hat Anfragen vorübergehend limitiert — die Synchronisierung wird beim nächsten Lauf fortgesetzt.",
    connection_failed: "Vorübergehendes Verbindungsproblem mit Stripe — prüfen Sie den Integrationsstatus.",
  },
};

const REVENUE_DROP_MESSAGE = {
  UA: (name, pct) => `Виручка "${name}" впала на ${pct}%`,
  EN: (name, pct) => `Revenue for ${name} dropped ${pct}%`,
  DE: (name, pct) => `Umsatz von ${name} ist um ${pct}% gesunken`,
};

// Отдельный, более быстрый сигнал специально про технический сбой (упал
// Stripe/чекаут/сайт), а не про спад спроса — см. обсуждение с пользователем:
// сравнение "последние N часов vs предыдущие N часов" ложно срабатывает на
// обычный суточный ритм (вечер тише ночи и т.п.), поэтому вместо % от
// выручки здесь считаем "давно не было ни одного платежа, хотя обычно
// бывают" — порог свой для каждого бизнеса, по его собственной истории.
const PAYMENT_SILENCE_MESSAGE = {
  UA: (name, hours) => `У "${name}" вже ${hours} год. немає жодного успішного платежу — це довше, ніж зазвичай`,
  EN: (name, hours) => `${name} has had no successful payments for ${hours}h — longer than usual`,
  DE: (name, hours) => `${name} hatte seit ${hours} Std. keine erfolgreiche Zahlung — länger als üblich`,
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
    UA: `Виручка ${direction.UA} на ${Math.abs(changePct).toFixed(0)}% (з $${yesterday.revenue} до $${today.revenue}), маржа ${marginWord.UA} і становить ${today.margin_pct}%. ${checkList.UA}`,
    EN: `Revenue ${direction.EN} ${Math.abs(changePct).toFixed(0)}% (from $${yesterday.revenue} to $${today.revenue}), margin ${marginWord.EN} at ${today.margin_pct}%. ${checkList.EN}`,
    DE: `Der Umsatz ist um ${Math.abs(changePct).toFixed(0)}% ${direction.DE} (von $${yesterday.revenue} auf $${today.revenue}), die Marge ist ${marginWord.DE} bei ${today.margin_pct}%. ${checkList.DE}`,
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

async function main(businessId, options = {}) {
  // sinceDays — используется ТОЛЬКО для одноразового бэкфилла исторических
  // данных при первом подключении интеграции (см. app/api/cron/backfill-
  // historical/route.js). Обычный часовой/суточный крон вызывает runSync()
  // без options — поведение (48ч окно + самолечение пропусков за 30 дней)
  // не меняется.
  const sinceDaysOverride = options.sinceDays || null;
  let query = admin
    .from("integrations")
    .select("id, business_id, api_key_encrypted, config")
    .eq("provider", "stripe")
    .eq("status", "connected");
  if (businessId) query = query.eq("business_id", businessId);
  const { data: integrations, error: fetchErr } = await query;

  // ФІКС: раніше `error` тут ігнорувався — якщо цей запит падав (мережевий
  // збій, тимчасова недоступність Supabase, RLS), `integrations` ставало
  // null, і код мовчки вирішував "інтеграцій немає", хоча насправді впав
  // сам запит. Жодного логу, Stripe-синк тихо нічого не робив для ВСІХ
  // бізнесів у цьому прогоні. Той самий паттерн, що вже був у
  // shopify-sync.mjs / meta-ads-sync.mjs / google-ads-sync.mjs — тепер і тут.
  if (fetchErr) {
    console.error("Failed to fetch stripe integrations:", fetchErr.message);
    await logError({ source: "stripe", message: "Failed to fetch stripe integrations list", details: fetchErr.message });
    return;
  }
  if (!integrations?.length) {
    console.log("No connected Stripe integrations, nothing to sync.");
    return;
  }

  for (const integ of integrations) {
    try {
      const apiKey = decrypt(integ.api_key_encrypted);

      // Тепер тягнемо business (і його timezone) ОДРАЗУ — раніше цей запит
      // стояв нижче, ПІСЛЯ gap-detection і групування charges по датах, тому
      // обидва кроки змушено рахували дату по UTC. Локальна дата бізнеса
      // потрібна вже тут.
      const { data: business, error: bizErr } = await admin
        .from("businesses")
        .select("id, user_id, name, cost_pct, timezone, alert_sensitivity")
        .eq("id", integ.business_id)
        .maybeSingle();
      if (!business) continue;
      const bizTimezone = business.timezone || "UTC";

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
      // Дати тут — локальні дати бізнеса (так само пишуться в metrics_computed
      // нижче), не UTC.
      let sinceUnix = Math.floor(Date.now() / 1000) - 48 * 3600;
      if (sinceDaysOverride) {
        // Бэкфилл: игнорируем gap-детекцию за 30 дней ниже — сразу берём
        // всё окно, которое просили (например, 365 дней при первом
        // подключении), чтобы графики/реконструкция/дайджест могли
        // опираться на реальную историю Stripe, а не только на дни после
        // подключения.
        sinceUnix = Math.floor(Date.now() / 1000) - sinceDaysOverride * 24 * 3600;
      }
      const { data: existingDatesRows } = await admin
        .from("metrics_computed")
        .select("date")
        .eq("business_id", integ.business_id)
        .gte("date", localDateStr(bizTimezone, Math.floor(Date.now() / 1000) - 30 * 24 * 3600))
        .order("date", { ascending: true });
      const existingDateSet = new Set((existingDatesRows || []).map((r) => r.date));
      if (!sinceDaysOverride && existingDateSet.size > 0) {
        const earliestKnown = [...existingDateSet][0];
        for (let i = 2; i < 30; i++) {
          const atSec = Math.floor(Date.now() / 1000) - i * 24 * 3600;
          const d = localDateStr(bizTimezone, atSec);
          if (d < earliestKnown) break;
          if (!existingDateSet.has(d)) {
            sinceUnix = Math.min(sinceUnix, atSec - 12 * 3600); // запас у пів доби, щоб точно захопити весь локальний день
          }
        }
      }

      const charges = await fetchStripeCharges(apiKey, sinceUnix);
      const successful = charges.filter((c) => c.paid && !c.refunded);

      const byDate = {};
      for (const c of successful) {
        const date = localDateStr(bizTimezone, c.created);
        if (!byDate[date]) byDate[date] = { revenue: 0, orders: 0, stripeFee: 0 };
        byDate[date].revenue += c.amount / 100;
        byDate[date].orders += 1;
        // c.balance_transaction expanded above; может быть null, если ещё не заселилось (pending)
        const feeCents = c.balance_transaction?.fee ?? 0;
        byDate[date].stripeFee += feeCents / 100;
      }

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
      // last24h/prev24h тепер рахуються нижче, одразу після того як дізнаємось
      // business.timezone — див. коментар там (це вже не "останні 24 години",
      // а "з півночі по місцевому часу бізнесу до зараз" vs "той самий
      // проміжок вчора").

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
      const todayStr = localDateStr(bizTimezone);
      for (let t = sinceUnix; t <= Math.floor(Date.now() / 1000); t += 24 * 3600) {
        const d = localDateStr(bizTimezone, t);
        if (!byDate[d]) byDate[d] = { revenue: 0, orders: 0, stripeFee: 0 };
      }
      if (!byDate[todayStr]) byDate[todayStr] = { revenue: 0, orders: 0, stripeFee: 0 };

      // business (і bizTimezone) вже отримано на початку ітерації — другий
      // запит тут прибрано, він лише дублював перший.

      // ФІКС: раніше "останні 24 години" рахувались просто як ковзне вікно
      // від поточного моменту — це прибирало хибне "впало до $0" опівночі,
      // але водночас робило % на дашборді неспівставним із денними
      // стовпчиками на графіку (стовпчик по календарному дню, а % — по
      // довільному 24-годинному вікну, яке саму північ ігнорує). Тепер
      // рахуємо "з півночі по МІСЦЕВОМУ часу бізнесу до зараз" проти "той
      // самий проміжок часу вчора" — довжина вікон однакова (тому опівночі
      // все ще нема хибного "-100%": о 00:05 порівнюються перші 5 хвилин
      // сьогодні з першими 5 хвилинами вчора, а не з ЦІЛИМ вчорашнім днем),
      // і водночас це той самий "сьогоднішній день", що намальований
      // останнім стовпчиком на дашборді.
      function getLocalMidnightUnixSec(timezone, atSec) {
        const date = new Date(atSec * 1000);
        try {
          const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit",
            hour12: false,
          }).formatToParts(date);
          const get = (type) => parts.find((p) => p.type === type)?.value;
          const y = Number(get("year")), mo = Number(get("month")), d = Number(get("day"));
          const hh = get("hour") === "24" ? 0 : Number(get("hour"));
          const mm = Number(get("minute")), ss = Number(get("second"));
          const localAsUTC = Date.UTC(y, mo - 1, d, hh, mm, ss);
          const offsetMs = localAsUTC - date.getTime(); // фактичний зсув таймзони в цю мить (з урахуванням DST)
          const localMidnightAsUTC = Date.UTC(y, mo - 1, d, 0, 0, 0);
          return Math.floor((localMidnightAsUTC - offsetMs) / 1000);
        } catch {
          // Невідома/некоректна таймзона в базі — падаємо назад на UTC-північ,
          // а не ламаємо синк повністю.
          return Math.floor(date.getTime() / 1000 / 86400) * 86400;
        }
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const todayMidnightSec = getLocalMidnightUnixSec(bizTimezone, nowSec);
      const elapsedTodaySec = nowSec - todayMidnightSec;
      const last24h = sumChargesWindow(todayMidnightSec, nowSec + 1);
      const prev24h = sumChargesWindow(todayMidnightSec - 24 * 3600, todayMidnightSec - 24 * 3600 + elapsedTodaySec + 1);

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
        .select("status, last_synced_at, config")
        .eq("business_id", business.id)
        .eq("provider", "shopify")
        .maybeSingle();
      // Раніше тут перевірявся лише status === "connected", який ставиться
      // одразу після OAuth (до першого реального синку). У вікні між
      // "токен збережено" і "перший синк відпрацював" costPct мовчки ставав
      // 0 (бо ми вже "довіряли" Shopify-COGS, якого фізично ще нема в
      // expenses) — маржа виглядала стабільно високою і не реагувала на
      // падіння виручки. Тепер вимагаємо, щоб хоча б один синк реально
      // пройшов (last_synced_at заповнений).
      const shopifyConnected = shopifyIntegration?.status === "connected" && !!shopifyIntegration?.last_synced_at;
      // Дефолт (немає config.revenue_mode або "replace") — Shopify стає
      // єдиним джерелом revenue, бо для більшості магазинів це ті самі
      // гроші, що вже пройшли через Stripe як процесор всередині Shopify
      // Checkout. Якщо користувач явно позначив магазин як окремий потік
      // ("add"), Stripe продовжує писати revenue як завжди, а
      // shopify-sync.mjs додає свою суму зверху (див. upsertShopifyRevenue).
      const shopifyRevenueAuthoritative = shopifyConnected && shopifyIntegration?.config?.revenue_mode !== "add";

      const costPct = shopifyConnected ? 0 : Number(business.cost_pct) || 30;

      // Дашборд (карточки Дохід/Прибуток/Маржа) раньше сравнивал "этот
      // месяц-до-сегодня" с прошлым месяцем — рядом с бейджем "Наживо" это
      // смотрелось не по-настоящему live, да ещё и страдало той же
      // календарной болезнью, что мы чинили в revenue_drop. Пишем сюда те
      // же last24h/prev24h, что уже считаем для алертов — один источник
      // правды, дашборд просто читает готовое значение, без своего пересчёта.
      {
        const last24hCost = Number((last24h.revenue * (costPct / 100) + last24h.stripeFee).toFixed(2));
        const prev24hCost = Number((prev24h.revenue * (costPct / 100) + prev24h.stripeFee).toFixed(2));
        await admin
          .from("businesses")
          .update({
            rolling_metrics: {
              revenue_last24h: last24h.revenue,
              revenue_prev24h: prev24h.revenue,
              profit_last24h: Number((last24h.revenue - last24hCost).toFixed(2)),
              profit_prev24h: Number((prev24h.revenue - prev24hCost).toFixed(2)),
              margin_last24h: last24h.revenue > 0 ? Number((((last24h.revenue - last24hCost) / last24h.revenue) * 100).toFixed(1)) : 0,
              margin_prev24h: prev24h.revenue > 0 ? Number((((prev24h.revenue - prev24hCost) / prev24h.revenue) * 100).toFixed(1)) : 0,
              updated_at: new Date().toISOString(),
            },
          })
          .eq("id", business.id);
      }

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

        // Якщо Shopify авторитетний по revenue для цього бізнесу — не
        // пишемо сюди Stripe-revenue: інакше залежно від того, який крон
        // відпрацював останнім (Stripe чи Shopify), цифра стрибала б туди-
        // сюди. shopify-sync.mjs (upsertShopifyRevenue) лишається єдиним,
        // хто пише revenue за цю дату в такому режимі.
        // ВІДОМЕ ОБМЕЖЕННЯ: rolling_metrics (бейдж "Наживо" на дашборді) і
        // поріг revenue_drop нижче за текстом досі рахуються тільки зі
        // Stripe-даних навіть у цьому режимі — це наступний крок, не чіпаємо
        // в цьому проході, щоб не ламати вже робочі алерти наосліп.
        if (!shopifyRevenueAuthoritative) {
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
        }

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
          // относительный % ничего не значит. Этот "шумовой пол" НЕ зависит
          // от чувствительности — это отдельная защита, а не сам порог.
          const MIN_REVENUE_FOR_ALERT = 20;
          const tooSmallToMatter = prev24h.revenue < MIN_REVENUE_FOR_ALERT;

          // "Чутливість сповіщень" (Settings) масштабує сам поріг падіння
          // (базово 20%) і межі severity (35%/50%) — так пропорції між
          // medium/high/critical лишаються тими самими незалежно від того,
          // яку чутливість обрав власник.
          const sensitivityMultiplier = resolveSensitivityMultiplier(business.alert_sensitivity);
          const dropThresholdPct = 20 * sensitivityMultiplier;
          const highSeverityPct = 35 * sensitivityMultiplier;
          const criticalSeverityPct = 50 * sensitivityMultiplier;

          if (change > -dropThresholdPct || tooSmallToMatter) {
            const { data: resolved, error: resolveErr } = await admin
              .from("alerts_log")
              .update({ status: "resolved" })
              .eq("business_id", business.id)
              .eq("type", "revenue_drop")
              .eq("status", "open")
              .select("id");
          }

          if (change <= -dropThresholdPct && !tooSmallToMatter && !(await hasRecentAlert(business.id, "revenue_drop"))) {
            const severity = change <= -criticalSeverityPct ? "critical" : change <= -highSeverityPct ? "high" : "medium";

            const { data: user } = await admin
              .from("users")
              .select("telegram_id, email, email_enabled, push_enabled, language")
              .eq("id", business.user_id)
              .maybeSingle();

            const userLang = user?.language || "EN";
            const buildMessage = REVENUE_DROP_MESSAGE[userLang] || REVENUE_DROP_MESSAGE.EN;
            const message = buildMessage(business.name, Math.abs(change).toFixed(0));

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

            // Раньше здесь вручную дублировались дедуп/insert/отправка
            // владельцу (своя копия логики sendAlert() из lib/alerts.mjs), а
            // фан-аут команде передавал в sendTelegram() объект участника
            // целиком вместо его telegram_id — Telegram API молча отклонял
            // такой chat_id, и fetch() без проверки .ok это никак не
            // логировал. Теперь используем ту же sendAlertToBusiness(), что
            // и Shopify/Meta/Google Ads-синки: один дедуп (24ч по business_id
            // + type), корректная отправка владельцу и фан-аут команде с
            // фильтрацией по их categories.
            await sendAlertToBusiness(
              business.id,
              {
                // push_enabled раньше не проверялся здесь вовсе — тумблер
                // уведомлений в кабинете ни на что не влиял для этого
                // конкретного алерта (revenue_drop).
                telegramId: user?.push_enabled !== false ? user?.telegram_id : null,
                email: user?.email,
                emailEnabled: user?.email_enabled,
                userLang,
              },
              {
                type: "revenue_drop",
                severity,
                message,
                aiExplanation,
              }
            );
          }
        }
      }

      // "Тишина по платежам" — быстрый сигнал именно о технической проблеме,
      // не диллюированный суточным окном как revenue_drop. Порог — свой для
      // каждого бизнеса, по его собственной истории (не один общий порог
      // на все аккаунты — иначе для тихого бизнеса 3 часа без оплат норма, а
      // для бойкого — уже тревога).
      {
        const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
        const { data: history } = await admin
          .from("metrics_computed")
          .select("orders")
          .eq("business_id", business.id)
          .gte("date", fourteenDaysAgo)
          .lt("date", latestDate); // без сегодняшнего частичного дня

        const histDays = history || [];
        const avgDailyOrders = histDays.length
          ? histDays.reduce((s, r) => s + (r.orders || 0), 0) / histDays.length
          : 0;

        // Меньше 3 заказов/день в среднем — слишком мало истории, чтобы
        // считать "тишину" аномалией (для такого бизнеса и сутки без
        // платежей — обычное дело).
        if (avgDailyOrders >= 3) {
          const lastChargeAt = successful.length
            ? Math.max(...successful.map((c) => c.created))
            : null;
          const hoursSinceLastCharge = lastChargeAt
            ? (Date.now() / 1000 - lastChargeAt) / 3600
            : (Date.now() - sinceUnix * 1000) / 3600000; // за всё окно fetch'а не было ни одного платежа

          // "Обычный" разрыв между платежами при таком темпе, умноженный на
          // 4 (чтобы не дёргать по каждому чуть более длинному, чем средний,
          // перерыву) — но не меньше 2ч (не спамить по мелочи даже для очень
          // активных магазинов) и не больше 12ч (не заставлять ждать почти
          // сутки даже для менее активных).
          const typicalGapHours = 24 / avgDailyOrders;
          const quietThresholdHours = Math.min(12, Math.max(2, typicalGapHours * 4));

          const { data: user } = await admin
            .from("users")
            .select("telegram_id, email, email_enabled, push_enabled, language")
            .eq("id", business.user_id)
            .maybeSingle();
          const userLang = user?.language || "EN";

          if (hoursSinceLastCharge < quietThresholdHours) {
            await admin
              .from("alerts_log")
              .update({ status: "resolved" })
              .eq("business_id", business.id)
              .eq("type", "payment_silence_stripe")
              .eq("status", "open");
          } else {
            const { data: existingSilence } = await admin
              .from("alerts_log")
              .select("id")
              .eq("business_id", business.id)
              .eq("type", "payment_silence_stripe")
              .eq("status", "open")
              .limit(1);

            if (!existingSilence?.length) {
              const buildMsg = PAYMENT_SILENCE_MESSAGE[userLang] || PAYMENT_SILENCE_MESSAGE.EN;
              const message = buildMsg(business.name, Math.round(hoursSinceLastCharge));

              // Тот же фикс, что и для revenue_drop выше: раньше фан-аут
              // команде передавал участника целиком в sendTelegram(chatId, ...)
              // вместо его telegram_id — сообщение молча не доходило.
              // sendAlertToBusiness() пишет в alerts_log сама, поэтому
              // отдельный insert здесь больше не нужен.
              await sendAlertToBusiness(
                business.id,
                {
                  telegramId: user?.push_enabled !== false ? user?.telegram_id : null,
                  email: user?.email,
                  emailEnabled: user?.email_enabled,
                  userLang,
                },
                {
                  type: "payment_silence_stripe",
                  severity: "high",
                  message,
                  aiExplanation: null,
                }
              );
            }
          }
        }
      }

      // status: "connected" тут явно (а не тільки last_synced_at) — щоб
      // інтеграція, яка раніше впала в "error" (див. catch нижче), сама
      // "одужувала" на першому ж успішному прогоні, без ручного втручання.
      await admin
        .from("integrations")
        .update({ last_synced_at: new Date().toISOString(), status: "connected" })
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

      // ФІКС: раніше збій тут (протух API-ключ, Stripe відкликав доступ,
      // таймаут тощо) лишався видимим ЛИШЕ в error_logs (бачить тільки
      // адмін вручну). Інтеграція продовжувала показуватись "connected" у
      // кабінеті, власник ніколи не дізнавався, що Stripe-дані з якогось
      // моменту перестали оновлюватись. Shopify/Meta Ads/Google Ads-синки
      // вже роблять обидві ці речі при збої — тепер робить і Stripe.
      const reason = getSyncFailureReason(err);
      await admin
        .from("integrations")
        .update({ status: "error", config: { ...(integ.config || {}), sync_error_reason: reason } })
        .eq("id", integ.id);

      const { data: failedBusiness } = await admin
        .from("businesses")
        .select("user_id")
        .eq("id", integ.business_id)
        .maybeSingle();
      if (failedBusiness?.user_id) {
        const contact = await getUserContact(failedBusiness.user_id);
        const msg = (SYNC_FAILURE_MESSAGE[contact.userLang] || SYNC_FAILURE_MESSAGE.EN)();
        const explanation = (SYNC_FAILURE_EXPLANATION[contact.userLang] || SYNC_FAILURE_EXPLANATION.EN)[reason];
        await sendAlertToBusiness(integ.business_id, contact, {
          type: "sync_failure_stripe",
          severity: "high",
          message: msg,
          aiExplanation: explanation,
        });
      }
    }
  }
}

export async function runSync(businessId, options = {}) {
  await main(businessId, options);
  return { synced: true, timestamp: new Date().toISOString() };
}