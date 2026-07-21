const { Bot, InlineKeyboard } = require("grammy");
const { supabase } = require("./supabase");
const { getDict, formatMoney } = require("./i18n");

const bot = new Bot(process.env.BOT_TOKEN);
const SITE_URL = process.env.SITE_URL || "https://rivant-os.vercel.app";

function mainMenu(lang) {
  const d = getDict(lang);
  return new InlineKeyboard()
    .text(d.menu.summary, "summary").row()
    .text(d.menu.metrics, "metrics").row()
    .text(d.menu.problems, "problems").row()
    .text(d.menu.subscription, "subscription").row()
    .text(d.menu.integrations, "integrations");
}

// ---------------------------------------------------------------------------
// /start [token] — привязка Telegram к аккаунту на сайте
// ---------------------------------------------------------------------------
bot.command("start", async (ctx) => {
  const token = ctx.match?.trim();

  if (!token) {
    // язык ещё неизвестен (пользователь не найден) — отвечаем на английском по умолчанию
    return ctx.reply(getDict("EN").welcomeNoToken, { link_preview_options: { is_disabled: true } });
  }

  const { data: linkToken, error } = await supabase
    .from("link_tokens")
    .select("*")
    .eq("token", token)
    .eq("used", false)
    .maybeSingle();

  if (error || !linkToken) {
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

  await ctx.reply(d.linkSuccess, { reply_markup: mainMenu(lang) });
});

// ---------------------------------------------------------------------------
// Middleware: подтягиваем пользователя, язык и статус доступа
// ---------------------------------------------------------------------------
async function loadUserContext(ctx, next) {
  const { data: user } = await supabase
    .from("users")
    .select("id, email, language")
    .eq("telegram_id", ctx.from.id)
    .maybeSingle();

  const lang = user?.language || "EN";
  const d = getDict(lang);
  ctx.rivant = { user, lang, d };

  if (!user) {
    await ctx.reply(d.accountNotFound(SITE_URL));
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
  return !ctx.rivant.subscription || ctx.rivant.subscription.access_status === "blocked";
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
  const d = ctx.rivant.d;
  await ctx.reply(d.mainMenuTitle, { reply_markup: mainMenu(ctx.rivant.lang) });
});

// ---------------------------------------------------------------------------
// 📊 Сводка сегодня
// ---------------------------------------------------------------------------
bot.callbackQuery("summary", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireAccess(ctx))) return;
  const { lang, d, user } = ctx.rivant;

  const { data: business } = await supabase
    .from("businesses")
    .select("id, name")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!business) return ctx.reply(d.noBusiness(SITE_URL));

  const today = new Date().toISOString().slice(0, 10);
  const { data: metric } = await supabase
    .from("metrics_computed")
    .select("revenue, cost, margin_pct, orders")
    .eq("business_id", business.id)
    .eq("date", today)
    .maybeSingle();

  if (!metric) return ctx.reply(d.noMetricsToday(business.name));

  await ctx.reply(
    `${d.summaryTitle(business.name)}\n\n` +
      `${d.revenueLabel}: *${formatMoney(metric.revenue, lang)}*\n` +
      `${d.costLabel}: *${formatMoney(metric.cost, lang)}*\n` +
      `${d.marginLabel}: *${metric.margin_pct}%*\n` +
      `${d.ordersLabel}: *${metric.orders}*`,
    { parse_mode: "Markdown" }
  );
});

// ---------------------------------------------------------------------------
// 📈 Метрики недели
// ---------------------------------------------------------------------------
bot.callbackQuery("metrics", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireAccess(ctx))) return;
  const { lang, d, user } = ctx.rivant;

  const { data: business } = await supabase
    .from("businesses")
    .select("id, name")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!business) return ctx.reply(d.noBusiness(SITE_URL));

  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: rows } = await supabase
    .from("metrics_computed")
    .select("date, revenue, margin_pct")
    .eq("business_id", business.id)
    .gte("date", weekAgo)
    .order("date", { ascending: true });

  if (!rows?.length) return ctx.reply(d.noWeekData);

  const lines = rows
    .map((r) => `${r.date}: ${formatMoney(r.revenue, lang)} (${d.marginWord} ${r.margin_pct}%)`)
    .join("\n");

  await ctx.reply(`${d.metricsTitle(business.name)}\n\n${lines}`, { parse_mode: "Markdown" });
});

// ---------------------------------------------------------------------------
// ⚠️ Активные проблемы
// ---------------------------------------------------------------------------
bot.callbackQuery("problems", async (ctx) => {
  await ctx.answerCallbackQuery();
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
});

// ---------------------------------------------------------------------------
// 💳 Подписка
// ---------------------------------------------------------------------------
bot.callbackQuery("subscription", async (ctx) => {
  await ctx.answerCallbackQuery();
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
});

// ---------------------------------------------------------------------------
// 🔗 Источники данных
// ---------------------------------------------------------------------------
bot.callbackQuery("integrations", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireAccess(ctx))) return;
  const { d, user } = ctx.rivant;

  const { data: businesses } = await supabase.from("businesses").select("id").eq("user_id", user.id);
  const ids = (businesses || []).map((b) => b.id);

  await ctx.reply(ids.length ? d.integrationsConnected(ids.length, SITE_URL) : d.integrationsNone(SITE_URL));
});

bot.on("message", async (ctx) => {
  await ctx.reply(ctx.rivant?.d?.fallback || getDict("EN").fallback);
});

module.exports = { bot };