const { Bot, InlineKeyboard, Keyboard } = require("grammy");
const { supabase } = require("./supabase");
const { getDict, formatMoney } = require("./i18n");
const { getFullMarginForDay } = require("../lib/margin");

const bot = new Bot(process.env.BOT_TOKEN);
const SITE_URL = process.env.SITE_URL || "https://rivant-os.vercel.app";

// Локальна дата бізнесу (не UTC) — той самий підхід, що й у
// scripts/daily-reports.mjs (localDateStr). Продубльовано тут навмисно:
// bot.js — CommonJS (require), daily-reports.mjs — ESM (.mjs), змішувати
// їх в один спільний модуль зараз не варте ризику. Якщо колись міняєш
// логіку тут — онови так само і в daily-reports.mjs.
//
// РАНІШЕ бот рахував "сьогодні" як new Date().toISOString().slice(0,10)
// (UTC-дата) — для бізнесу поза UTC (майже всі) це могло не збігатися з
// тим днем, який щойно записав у metrics_computed синк (там теж тепер
// локальна дата бізнесу, див. scripts/sync-stripe-core.mjs), і /summary
// в боті міг показати "немає даних за сьогодні" або дані не того дня,
// що на сайті.
const FALLBACK_TZ = "Europe/Kyiv";
function localDateStr(tz) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || FALLBACK_TZ }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: FALLBACK_TZ }).format(new Date());
  }
}

// getFullMarginForDay вынесена в lib/margin.js (аудит #2, находка №1) —
// теперь единая формула для кабинета, бота, прогноза и дайджеста.

function mainMenu(lang) {
  const d = getDict(lang);
  return new InlineKeyboard()
    .text(d.menu.summary, "summary").row()
    .text(d.menu.metrics, "metrics").row()
    .text(d.menu.problems, "problems").row()
    .text(d.menu.subscription, "subscription").row()
    .text(d.menu.integrations, "integrations").row()
    .text(d.menu.team, "team").row()
    .url(d.menu.support || "💬 Support", "https://t.me/official_rivant");
}

// ---------------------------------------------------------------------------
// Клавиатура внизу экрана (Reply Keyboard) — сворачиваемая
// ---------------------------------------------------------------------------
// В отличие от InlineKeyboard (кнопки внутри одного конкретного сообщения,
// которые быстро "уезжают" вверх в потоке алертов и уведомлений), это
// клавиатура уровня чата. Она привязывается к чату один раз (см. /start,
// /menu), но НЕ навязывается пользователю постоянно: он может свернуть её
// нажатием на квадратную иконку рядом со скрепкой — она снова раскроется
// по тому же нажатию, как на референсном скрине с подарком.
//
// .resized() — кнопки компактного размера, а не на всю высоту экрана.
// Флаг .persistent() (Bot API 7.0+) намеренно НЕ используется — именно он
// раньше принудительно держал клавиатуру развёрнутой всегда и не давал
// пользователю её свернуть за иконку. Без него Telegram-клиент сам
// показывает маленькую иконку клавиатуры рядом со скрепкой, и пользователь
// открывает/закрывает кнопки по тапу на неё.
function persistentMenu(lang) {
  const d = getDict(lang);
  return new Keyboard()
    .text(d.menu.summary).row()
    .text(d.menu.metrics).text(d.menu.problems).row()
    .text(d.menu.subscription).text(d.menu.integrations).row()
    .text(d.menu.team).text(d.menu.support || "💬 Support")
    .resized();
}

// Массив подписей кнопки на всех 3 языках сразу — чтобы bot.hears() ловил
// нажатие независимо от того, на каком языке сейчас у пользователя стоит
// клавиатура (например, если он сменил язык в кабинете, но старое
// сообщение с клавиатурой на предыдущем языке ещё не переотправлено).
function allLabels(menuKey) {
  return ["EN", "UA", "DE"].map((l) => getDict(l).menu[menuKey]).filter(Boolean);
}

// ---------------------------------------------------------------------------
// /start [token] — привязка Telegram к аккаунту на сайте
// ---------------------------------------------------------------------------
bot.command("start", async (ctx) => {
  const token = ctx.match?.trim();

  if (!token) {
    return ctx.reply(getDict("EN").welcomeNoToken, { link_preview_options: { is_disabled: true } });
  }

  // Командний інвайт (допуслуга "Сповіщення для команди") — окрема гілка,
  // бо прив'язує telegram_id до team_members (business_id), а не до
  // users.telegram_id, як звичайний /start токен власника акаунту нижче.
  if (token.startsWith("tm_")) {
    const { data: invite } = await supabase
      .from("team_invites")
      .select("*")
      .eq("token", token)
      .eq("used", false)
      .maybeSingle();

    if (!invite || new Date(invite.expires_at) < new Date()) {
      return ctx.reply(getDict("EN").linkInvalid);
    }

    // Подвійна перевірка активної підписки на випадок, якщо вона скасувалась
    // уже ПІСЛЯ того, як власник згенерував посилання (див. app/api/team/invite).
    const { data: addon } = await supabase
      .from("addon_subscriptions")
      .select("status, current_period_end")
      .eq("business_id", invite.business_id)
      .eq("addon_type", "team_alerts")
      .maybeSingle();

    if (!addon || addon.status !== "active" || new Date(addon.current_period_end) < new Date()) {
      return ctx.reply(
        "Ця підписка на командні сповіщення більше не активна. Попросіть власника акаунту оновити оплату та надіслати нове посилання."
      );
    }

    const { error: upsertError } = await supabase.from("team_members").upsert(
      {
        business_id: invite.business_id,
        telegram_id: ctx.from.id,
        telegram_username: ctx.from.username || null,
        invited_by: invite.created_by,
        status: "active",
        // Категорії задає власник під час генерації посилання
        // (app/api/team/invite) — переносимо їх на нового учасника.
        // Фолбек на всі категорії лишень на випадок старих запрошень,
        // створених до появи цього поля (invite.categories буде null).
        categories: invite.categories || ["revenue", "marketing", "inventory", "technical"],
      },
      { onConflict: "business_id,telegram_id" }
    );
    await supabase.from("team_invites").update({ used: true, used_by_telegram_id: ctx.from.id }).eq("token", token);

    if (upsertError) {
      return ctx.reply("Сталася помилка приєднання до команди. Спробуйте ще раз пізніше.");
    }
    return ctx.reply("✅ Вас додано до команди RIVANT. Тепер ви отримуватимете сповіщення про бізнес-алерти в цьому чаті.");
  }

  const { data: linkToken, error } = await supabase
    .from("link_tokens")
    .select("*")
    .eq("token", token)
    .eq("used", false)
    .maybeSingle();

  // п. B5 аудита: раніше перевіряли тільки used=false, без урахування
  // строку дії — токен, що одного разу засвітився (скріншот, історія
  // браузера), лишався робочим назавжди. Тепер той самий стандарт, що вже
  // застосовано вище для team_invites (tm_-токенів).
  if (error || !linkToken || new Date(linkToken.expires_at) < new Date()) {
    return ctx.reply(getDict("EN").linkInvalid);
  }

  await supabase.from("users").update({ telegram_id: ctx.from.id }).eq("id", linkToken.user_id);
  await supabase.from("link_tokens").update({ used: true }).eq("token", token);

  const { data: user } = await supabase
    .from("users")
    .select("language")
    .eq("id", linkToken.user_id)
    .maybeSingle();
  const lang = user?.language || "EN";
  const d = getDict(lang);

  // Сначала закрепляем постоянную клавиатуру снизу (остаётся у всех
  // будущих сообщений — алертов, дайджестов и т.д.), отдельным сообщением
  // отправляем инлайн-меню для самого первого знакомства с разделами.
  await ctx.reply(d.mainMenuTitle, { reply_markup: persistentMenu(lang) });
  await ctx.reply(d.linkSuccess, { reply_markup: mainMenu(lang) });
});

// ---------------------------------------------------------------------------
// Middleware: подтягиваем пользователя, язык и статус доступа
// ---------------------------------------------------------------------------
async function loadUserContext(ctx, next) {
  const { data: user } = await supabase
    .from("users")
    .select("id, email, language, is_blocked")
    .eq("telegram_id", ctx.from.id)
    .maybeSingle();

  const lang = user?.language || "EN";
  const d = getDict(lang);
  ctx.rivant = { user, lang, d };

  if (!user) {
    await ctx.reply(d.accountNotFound(SITE_URL));
    return;
  }

  // Логируем любое взаимодействие (клик по кнопке или сообщение) для аналитики
  const eventType = ctx.callbackQuery ? `tg_click_${ctx.callbackQuery.data}` : "tg_message";
  supabase.from("user_events").insert({
    user_id: user.id,
    event_type: eventType,
    channel: "telegram",
  }).then(() => {}, (e) => console.error("event log failed", e));

  if (user.is_blocked) {
    await ctx.reply(
      lang === "UA"
        ? "🔒 Ваш акаунт заблоковано. Зверніться в підтримку, якщо вважаєте це помилкою."
        : lang === "DE"
        ? "🔒 Ihr Konto wurde gesperrt. Kontaktieren Sie den Support, falls dies ein Fehler ist."
        : "🔒 Your account has been suspended. Contact support if you think this is a mistake."
    );
    return;
  }

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("plan, access_status, current_period_end")
    .eq("user_id", user.id)
    .maybeSingle();

  ctx.rivant.subscription = sub;
  await next();
}

bot.use(loadUserContext);

function isBlocked(ctx) {
  const sub = ctx.rivant.subscription;
  if (!sub) return true;
  if (sub.access_status === "blocked") return true;
  if (sub.current_period_end && new Date(sub.current_period_end) < new Date()) return true;
  return false;
}

async function requireAccess(ctx) {
  if (isBlocked(ctx)) {
    await ctx.answerCallbackQuery?.();
    await ctx.reply(ctx.rivant.d.blocked(SITE_URL));
    return false;
  }
  return true;
}

bot.command("menu", async (ctx) => {
  const { d, lang } = ctx.rivant;
  // На случай если постоянная клавиатура снизу пропала (например, юзер
  // нажал "Очистить историю" в клиенте) — /menu переотправляет её заново,
  // плюс инлайн-меню как раньше.
  await ctx.reply(d.mainMenuTitle, { reply_markup: persistentMenu(lang) });
  await ctx.reply(d.mainMenuTitle, { reply_markup: mainMenu(lang) });
});

// ---------------------------------------------------------------------------
// 📊 Сводка сегодня
// ---------------------------------------------------------------------------
async function handleSummary(ctx) {
  if (!(await requireAccess(ctx))) return;
  const { lang, d, user } = ctx.rivant;

  const { data: business } = await supabase
    .from("businesses")
    .select("id, name, timezone")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!business) return ctx.reply(d.noBusiness(SITE_URL));

  const today = localDateStr(business.timezone);
  const { data: metric } = await supabase
    .from("metrics_computed")
    .select("revenue, cost, margin_pct, orders")
    .eq("business_id", business.id)
    .eq("date", today)
    .maybeSingle();

  if (!metric) return ctx.reply(d.noMetricsToday(business.name));

  const { marginPct } = await getFullMarginForDay(business.id, today, metric.revenue, metric.cost);

  await ctx.reply(
    `${d.summaryTitle(business.name)}\n\n` +
      `${d.revenueLabel}: *${formatMoney(metric.revenue, lang)}*\n` +
      `${d.costLabel}: *${formatMoney(metric.cost, lang)}*\n` +
      `${d.marginLabel}: *${marginPct}%*\n` +
      `${d.ordersLabel}: *${metric.orders}*`,
    { parse_mode: "Markdown" }
  );
}
bot.callbackQuery("summary", async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleSummary(ctx);
});
bot.hears(allLabels("summary"), handleSummary);

// ---------------------------------------------------------------------------
// 📈 Метрики недели
// ---------------------------------------------------------------------------
async function handleMetrics(ctx) {
  if (!(await requireAccess(ctx))) return;
  const { lang, d, user } = ctx.rivant;

  const { data: business } = await supabase
    .from("businesses")
    .select("id, name, timezone")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!business) return ctx.reply(d.noBusiness(SITE_URL));

  const todayLocal = localDateStr(business.timezone);
  const weekAgo = (() => {
    const d = new Date(`${todayLocal}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 7);
    return d.toISOString().slice(0, 10);
  })();
  const { data: rows } = await supabase
    .from("metrics_computed")
    .select("date, revenue, cost, margin_pct")
    .eq("business_id", business.id)
    .gte("date", weekAgo)
    .order("date", { ascending: true });

  if (!rows?.length) return ctx.reply(d.noWeekData);

  const rowsWithFullMargin = await Promise.all(
    rows.map(async (r) => ({
      date: r.date,
      revenue: r.revenue,
      marginPct: (await getFullMarginForDay(business.id, r.date, r.revenue, r.cost)).marginPct,
    }))
  );

  const lines = rowsWithFullMargin
    .map((r) => `${r.date}: ${formatMoney(r.revenue, lang)} (${d.marginWord} ${r.marginPct}%)`)
    .join("\n");

  await ctx.reply(`${d.metricsTitle(business.name)}\n\n${lines}`, { parse_mode: "Markdown" });
}
bot.callbackQuery("metrics", async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleMetrics(ctx);
});
bot.hears(allLabels("metrics"), handleMetrics);

// ---------------------------------------------------------------------------
// ⚠️ Активные проблемы
// ---------------------------------------------------------------------------
async function handleProblems(ctx) {
  if (!(await requireAccess(ctx))) return;
  const { d, user } = ctx.rivant;

  const { data: businesses } = await supabase.from("businesses").select("id").eq("user_id", user.id);
  const ids = (businesses || []).map((b) => b.id);
  if (!ids.length) return ctx.reply(d.noBusiness(SITE_URL));

  const { data: alerts } = await supabase
    .from("alerts_log")
    .select("message, sent_at")
    .in("business_id", ids)
    .eq("status", "open")
    .order("sent_at", { ascending: false })
    .limit(10);

  if (!alerts?.length) return ctx.reply(d.noProblems);

  const lines = alerts.map((a) => `• ${a.message} (${new Date(a.sent_at).toLocaleDateString(getDict(ctx.rivant.lang).locale)})`).join("\n");
  await ctx.reply(`${d.problemsTitle}\n\n${lines}`, { parse_mode: "Markdown" });
}
bot.callbackQuery("problems", async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleProblems(ctx);
});
bot.hears(allLabels("problems"), handleProblems);

// ---------------------------------------------------------------------------
// 💳 Подписка
// ---------------------------------------------------------------------------
async function handleSubscription(ctx) {
  const { d, lang, subscription: sub } = ctx.rivant;

  if (!sub) return ctx.reply(d.subNotFound(SITE_URL));

  const statusLabel = d.subStatus[sub.access_status] || sub.access_status;
  const until = sub.current_period_end
    ? new Date(sub.current_period_end).toLocaleDateString(getDict(lang).locale)
    : "—";

  await ctx.reply(
    `${d.subTitle}\n\n${d.subPlan}: *${sub.plan}*\n${d.subStatusLabel}: ${statusLabel}\n${d.subUntil}: *${until}*\n\n${d.subManage(SITE_URL)}`,
    { parse_mode: "Markdown" }
  );
}
bot.callbackQuery("subscription", async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleSubscription(ctx);
});
bot.hears(allLabels("subscription"), handleSubscription);

// ---------------------------------------------------------------------------
// 🔗 Источники данных
// ---------------------------------------------------------------------------
async function handleIntegrations(ctx) {
  if (!(await requireAccess(ctx))) return;
  const { d, user } = ctx.rivant;

  const { data: businesses } = await supabase.from("businesses").select("id").eq("user_id", user.id);
  const ids = (businesses || []).map((b) => b.id);

  await ctx.reply(ids.length ? d.integrationsConnected(ids.length, SITE_URL) : d.integrationsNone(SITE_URL));
}
bot.callbackQuery("integrations", async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleIntegrations(ctx);
});
bot.hears(allLabels("integrations"), handleIntegrations);

// ---------------------------------------------------------------------------
// 👥 Учасники команди — тільки перегляд (той самий список, що в модалці
// "Керувати" в кабінеті). Відкликати доступ навмисно можна тільки з сайту:
// там дія прив'язана до авторизованої сесії, а тут — просто зручний
// перегляд для власника прямо в тому ж чаті, де приходять сповіщення.
// ---------------------------------------------------------------------------
async function handleTeam(ctx) {
  if (!(await requireAccess(ctx))) return;
  const { lang, d, user } = ctx.rivant;

  // .order("created_at", { ascending: true }) — той самий фікс детермінізму
  // вибору business_id, що і в /api/business-profile, /api/team/members.
  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!business) return ctx.reply(d.noBusiness(SITE_URL));

  const { data: members } = await supabase
    .from("team_members")
    .select("telegram_username, telegram_id, created_at")
    .eq("business_id", business.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (!members?.length) return ctx.reply(d.teamNone(SITE_URL));

  const locale = getDict(lang).locale;
  const lines = members
    .map((m) => {
      const joined = new Date(m.created_at).toLocaleDateString(locale);
      // Пріоритет @username (клікабельний сам по собі в Markdown) — а якщо
      // юзернейма нема, робимо клікабельним сам ID через tg://user?id=,
      // це відкриває профіль людини напряму в Telegram-клієнті.
      const name = m.telegram_username
        ? `@${m.telegram_username}`
        : m.telegram_id
        ? `[${m.telegram_id}](tg://user?id=${m.telegram_id})`
        : d.teamMemberWord;
      return `• ${name} (${d.teamJoinedWord} ${joined})`;
    })
    .join("\n");

  await ctx.reply(`${d.teamTitle}\n\n${lines}`, { parse_mode: "Markdown" });
}
bot.callbackQuery("team", async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleTeam(ctx);
});
bot.hears(allLabels("team"), handleTeam);

// Кнопка "Поддержка" на нижней клавиатуре — в Reply Keyboard (в отличие от
// InlineKeyboard) кнопки не умеют открывать ссылку напрямую, поэтому просто
// отправляем текст со ссылкой на тот же чат поддержки, что и url-кнопка в
// инлайн-меню.
bot.hears(allLabels("support"), async (ctx) => {
  await ctx.reply("https://t.me/official_rivant");
});

// ---------------------------------------------------------------------------
// 🔔 Ответ на промпт продления триала
// ---------------------------------------------------------------------------
bot.callbackQuery("trial_yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  const { user, d } = ctx.rivant;

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  await supabase.from("user_events").insert({
    user_id: user.id,
    business_id: business?.id || null,
    event_type: "trial_prompt_yes",
    channel: "telegram",
  });
  await supabase.from("interest_signals").insert({
    business_id: business?.id || null,
    email: user.email,
    response: "yes",
  });

  if (process.env.ADMIN_TELEGRAM_ID) {
  const notifyRes = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: process.env.ADMIN_TELEGRAM_ID,
      text: `🔥 Лид хочет продолжить: ${user.email}`,
    }),
  });
  if (!notifyRes.ok) {
    const errBody = await notifyRes.text();
    console.error("Admin notify failed:", notifyRes.status, errBody);
  }
}

  // Убираем кнопки из исходного сообщения
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  } catch (e) {
    console.error("failed to remove keyboard", e.message);
  }

  await ctx.reply(d.trialYesReply(SITE_URL), { link_preview_options: { is_disabled: true } });
});

bot.callbackQuery("trial_no", async (ctx) => {
  await ctx.answerCallbackQuery();
  const { user, d } = ctx.rivant;

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  await supabase.from("user_events").insert({
    user_id: user.id,
    business_id: business?.id || null,
    event_type: "trial_prompt_no",
    channel: "telegram",
  });
  await supabase.from("interest_signals").insert({
    business_id: business?.id || null,
    email: user.email,
    response: "not_now",
  });

  try {
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  } catch (e) {
    console.error("failed to remove keyboard", e.message);
  }

  await ctx.reply(d.trialNoReply);
});

bot.on("message", async (ctx) => {
  await ctx.reply(ctx.rivant?.d?.fallback || getDict("EN").fallback);
});

module.exports = { bot };