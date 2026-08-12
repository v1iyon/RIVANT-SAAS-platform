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
    .text(d.menu.integrations, "integrations").row()
    .text(d.menu.team, "team").row()
    .url(d.menu.support || "💬 Support", "https://t.me/official_rivant");
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

// ---------------------------------------------------------------------------
// 👥 Учасники команди — тільки перегляд (той самий список, що в модалці
// "Керувати" в кабінеті). Відкликати доступ навмисно можна тільки з сайту:
// там дія прив'язана до авторизованої сесії, а тут — просто зручний
// перегляд для власника прямо в тому ж чаті, де приходять сповіщення.
// ---------------------------------------------------------------------------
bot.callbackQuery("team", async (ctx) => {
  await ctx.answerCallbackQuery();
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

  await ctx.reply(d.trialNoReply || "Зрозуміло, дякуємо за відповідь!");
});

bot.on("message", async (ctx) => {
  await ctx.reply(ctx.rivant?.d?.fallback || getDict("EN").fallback);
});

module.exports = { bot };