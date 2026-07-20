const { Bot, InlineKeyboard } = require("grammy");
const { supabase } = require("./supabase");

const bot = new Bot(process.env.BOT_TOKEN);
const SITE_URL = process.env.SITE_URL || "https://rivant-os.vercel.app";

// ---------------------------------------------------------------------------
// Главное меню
// ---------------------------------------------------------------------------
function mainMenu() {
  return new InlineKeyboard()
    .text("📊 Сводка сегодня", "summary").row()
    .text("📈 Метрики недели", "metrics").row()
    .text("⚠️ Активные проблемы", "problems").row()
    .text("💳 Подписка", "subscription").row()
    .text("🔗 Мои источники данных", "integrations");
}

// ---------------------------------------------------------------------------
// /start [token] — привязка Telegram к аккаунту на сайте
// Сайт формирует ссылку вида: https://t.me/<bot_username>?start=<token>
// token заранее кладётся в таблицу link_tokens при клике "Подключить Telegram" в кабинете
// ---------------------------------------------------------------------------
bot.command("start", async (ctx) => {
  const token = ctx.match?.trim();

  if (!token) {
    return ctx.reply(
      "Привет! 👋 Это бот RIVANT.\n\nЧтобы подключить аккаунт, откройте кабинет на сайте и нажмите «Подключить Telegram» — я всё сделаю сам.",
      { link_preview_options: { is_disabled: true } }
    );
  }

  const { data: linkToken, error } = await supabase
    .from("link_tokens")
    .select("*")
    .eq("token", token)
    .eq("used", false)
    .maybeSingle();

  if (error || !linkToken) {
    return ctx.reply("Ссылка недействительна или уже использована. Сгенерируйте новую в кабинете.");
  }

  await supabase.from("users").update({ telegram_id: ctx.from.id }).eq("id", linkToken.user_id);
  await supabase.from("link_tokens").update({ used: true }).eq("token", token);

  await ctx.reply("✅ Telegram успешно привязан к вашему аккаунту RIVANT!", {
    reply_markup: mainMenu(),
  });
});

// ---------------------------------------------------------------------------
// Middleware: подтягиваем пользователя и статус доступа перед любым действием
// ---------------------------------------------------------------------------
async function loadUserContext(ctx, next) {
  const { data: user } = await supabase
    .from("users")
    .select("id, email")
    .eq("telegram_id", ctx.from.id)
    .maybeSingle();

  if (!user) {
    await ctx.reply("Аккаунт не найден. Подключите Telegram через кабинет на сайте: " + SITE_URL);
    return; // не идём дальше
  }

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("plan, access_status, current_period_end")
    .eq("user_id", user.id)
    .maybeSingle();

  ctx.rivant = { user, subscription: sub };
  await next();
}

bot.use(loadUserContext);

function isBlocked(ctx) {
  return !ctx.rivant.subscription || ctx.rivant.subscription.access_status === "blocked";
}

async function requireAccess(ctx) {
  if (isBlocked(ctx)) {
    await ctx.answerCallbackQuery?.();
    await ctx.reply(
      "🔒 Подписка не активна.\n\nПродлить доступ: " + SITE_URL + "/cabinet/billing"
    );
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Главное меню по команде
// ---------------------------------------------------------------------------
bot.command("menu", async (ctx) => {
  await ctx.reply("Главное меню:", { reply_markup: mainMenu() });
});

// ---------------------------------------------------------------------------
// 📊 Сводка сегодня
// ---------------------------------------------------------------------------
bot.callbackQuery("summary", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireAccess(ctx))) return;

  const { data: business } = await supabase
    .from("businesses")
    .select("id, name")
    .eq("user_id", ctx.rivant.user.id)
    .limit(1)
    .maybeSingle();

  if (!business) {
    return ctx.reply("Источники данных ещё не подключены. Сделайте это в кабинете: " + SITE_URL);
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data: metric } = await supabase
    .from("metrics_computed")
    .select("revenue, cost, margin_pct, orders")
    .eq("business_id", business.id)
    .eq("date", today)
    .maybeSingle();

  if (!metric) {
    return ctx.reply(`Данные за сегодня (${business.name}) ещё не посчитаны — загляните чуть позже.`);
  }

  await ctx.reply(
    `📊 *Сводка за сегодня — ${business.name}*\n\n` +
      `Выручка: *${metric.revenue?.toLocaleString("ru-RU")} ₽*\n` +
      `Расходы: *${metric.cost?.toLocaleString("ru-RU")} ₽*\n` +
      `Маржа: *${metric.margin_pct}%*\n` +
      `Заказы: *${metric.orders}*`,
    { parse_mode: "Markdown" }
  );
});

// ---------------------------------------------------------------------------
// 📈 Метрики недели
// ---------------------------------------------------------------------------
bot.callbackQuery("metrics", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireAccess(ctx))) return;

  const { data: business } = await supabase
    .from("businesses")
    .select("id, name")
    .eq("user_id", ctx.rivant.user.id)
    .limit(1)
    .maybeSingle();

  if (!business) return ctx.reply("Источники данных ещё не подключены.");

  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: rows } = await supabase
    .from("metrics_computed")
    .select("date, revenue, margin_pct")
    .eq("business_id", business.id)
    .gte("date", weekAgo)
    .order("date", { ascending: true });

  if (!rows?.length) return ctx.reply("Пока нет данных за последнюю неделю.");

  const lines = rows
    .map((r) => `${r.date}: ${r.revenue?.toLocaleString("ru-RU")} ₽ (маржа ${r.margin_pct}%)`)
    .join("\n");

  await ctx.reply(`📈 *Метрики за 7 дней — ${business.name}*\n\n${lines}`, { parse_mode: "Markdown" });
});

// ---------------------------------------------------------------------------
// ⚠️ Активные проблемы
// ---------------------------------------------------------------------------
bot.callbackQuery("problems", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireAccess(ctx))) return;

  const { data: businesses } = await supabase
    .from("businesses")
    .select("id")
    .eq("user_id", ctx.rivant.user.id);

  const ids = (businesses || []).map((b) => b.id);
  if (!ids.length) return ctx.reply("Источники данных ещё не подключены.");

  const { data: alerts } = await supabase
    .from("alerts_log")
    .select("message, sent_at")
    .in("business_id", ids)
    .eq("status", "open")
    .order("sent_at", { ascending: false })
    .limit(10);

  if (!alerts?.length) return ctx.reply("✅ Активных проблем нет.");

  const lines = alerts
    .map((a) => `• ${a.message} (${new Date(a.sent_at).toLocaleDateString("ru-RU")})`)
    .join("\n");

  await ctx.reply(`⚠️ *Активные проблемы*\n\n${lines}`, { parse_mode: "Markdown" });
});

// ---------------------------------------------------------------------------
// 💳 Подписка
// ---------------------------------------------------------------------------
bot.callbackQuery("subscription", async (ctx) => {
  await ctx.answerCallbackQuery();
  const sub = ctx.rivant.subscription;

  if (!sub) {
    return ctx.reply("Подписка не найдена. Оформить: " + SITE_URL + "/pricing");
  }

  const statusLabel = {
    trial: "🧪 Пробный период",
    active: "✅ Активна",
    grace: "⏳ Ожидаем оплату",
    blocked: "🔒 Заблокирована",
  }[sub.access_status] || sub.access_status;

  const until = sub.current_period_end
    ? new Date(sub.current_period_end).toLocaleDateString("ru-RU")
    : "—";

  await ctx.reply(
    `💳 *Ваша подписка*\n\nТариф: *${sub.plan}*\nСтатус: ${statusLabel}\nДействует до: *${until}*\n\nУправление и продление — в кабинете: ${SITE_URL}/cabinet/billing`,
    { parse_mode: "Markdown" }
  );
});

// ---------------------------------------------------------------------------
// 🔗 Источники данных
// ---------------------------------------------------------------------------
bot.callbackQuery("integrations", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireAccess(ctx))) return;

  const { data: businesses } = await supabase
    .from("businesses")
    .select("id")
    .eq("user_id", ctx.rivant.user.id);

  const ids = (businesses || []).map((b) => b.id);

  await ctx.reply(
    ids.length
      ? `Подключено бизнесов: ${ids.length}.\nУправлять источниками: ${SITE_URL}/cabinet/integrations`
      : `Источники ещё не подключены.\nПодключить: ${SITE_URL}/cabinet/integrations`
  );
});

// ---------------------------------------------------------------------------
// Фолбэк на прочие сообщения
// ---------------------------------------------------------------------------
bot.on("message", async (ctx) => {
  await ctx.reply("Не понял команду 🙂 Наберите /menu, чтобы открыть меню.");
});

module.exports = { bot };
