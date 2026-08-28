// supabase/functions/create-order/index.ts
//
// Вызывается фронтендом при открытии окна оплаты.
// Атомарно резервирует уникальную "сумму с хвостом центов",
// чтобы два параллельных покупателя одного и того же тарифа/допуслуги
// никогда не получили одинаковую exact_amount_cents, пока их заказы pending.
//
// Цена берётся из БД на сервере (тарифы — public.plans, допуслуги —
// ADDON_CATALOG ниже) — клиенту нельзя доверять сумму напрямую, иначе
// можно оплатить любой тариф/допуслугу за 1 цент.
//
// --------------------------------------------------------------------------
// CHANGELOG (crypto for add-ons, п.1 of the plan):
//
//   Принимает теперь { kind: "plan", plan_id, token } (старое поведение,
//   без изменений) ИЛИ { kind: "addon", addon_kind, addon_slug, token }
//   (новое). Резервирование суммы (случайный cents_offset 0..99 +
//   ретрай на 23505 unique_violation) переиспользуется для обоих —
//   уникальный индекс orders_pending_amount_unique общий на все pending
//   заказы вне зависимости от kind, так что сумма допуслуги никогда не
//   столкнётся с суммой тарифа автоматически, без доп. логики.
//
//   ADDON_CATALOG ниже — единственное место, где сейчас "живут" цены
//   допуслуг для крипто-оплаты (аналог public.plans, но захардкожено —
//   таблицы под цены допуслуг сейчас нет). Цены подставлены по реальному
//   прайсингу со страницы Add-ons: AI Historical Analysis $199 one-time,
//   AI Performance Digest $49/mo, Team Alert Access $29/mo. addon_kind в
//   каталоге — защита от рассинхрона с клиентом (whatif_analysis обязан
//   быть "order", а не "subscription", и т.п.), сервер не доверяет
//   присланному addon_kind напрямую.
//
//   Пишет в orders: kind='addon', addon_kind, addon_slug — те же
//   колонки/значения, которые уже читает патченный polygon-webhook.
//   plan_id для addon-заказов остаётся NULL.
//
//   FIX (locale bug): все user-facing ошибки этой функции были захардкожены
//   на русском ("Требуется авторизация", "Невалидная сессия",
//   "Профиль пользователя ещё не создан...", "Не удалось выделить
//   уникальную сумму..."). Дублировать переводы на 3 языка прямо в Deno-
//   функции — плохая идея (рассинхрон с фронтом гарантирован), поэтому
//   вместо текста теперь короткие машинные коды, как уже было у
//   missing_plan/invalid_plan/invalid_addon — перевод должен делать
//   фронт (тот же DICT-паттерн, что в PaymentModal.tsx).

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RECEIVING_WALLET = Deno.env.get("POLYGON_RECEIVING_WALLET")!; // один общий адрес
const ORDER_TTL_MINUTES = 30;
const MAX_OFFSET_ATTEMPTS = 25;

// ФІКС (аудит #2, знахідка №16): "*" пропускав виклик цієї функції з
// будь-якого домену. Ендпоінт захищений JWT, не куками, тож класичний CSRF
// тут не працює — це радше гігієна, ніж дірка. Звужуємо до реального
// домену RIVANT (той самий SITE_URL/фолбек, що вже використовується в
// src/bot.js), через env-змінну, щоб не хардкодити продакшн-домен прямо в
// Deno-функції (staging/preview деплої можуть відрізнятись).
const ALLOWED_ORIGIN = Deno.env.get("SITE_URL") || "https://rivant-os.com";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// --- ADDON CATALOG ---------------------------------------------------------
// Real prices from the Add-ons pricing page.
// addon_kind here is the source of truth the server trusts; whatever the
// client sends in the request body is only used to pick a slug, never to
// decide the kind or the price.
const ADDON_CATALOG: Record<string, { addon_kind: "order" | "subscription"; base_amount_cents: number }> = {
  whatif_analysis: { addon_kind: "order", base_amount_cents: 19900 }, // $199, one-time (AI Historical Analysis)
  monthly_digest: { addon_kind: "subscription", base_amount_cents: 4900 }, // $49/mo (AI Performance Digest)
  team_alerts: { addon_kind: "subscription", base_amount_cents: 2900 }, // $29/mo (Team Alert Access)
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req) => {
  // Браузер перед настоящим запросом сначала посылает "разведочный"
  // OPTIONS-запрос — ему нужно ответить пустым 200 с CORS-заголовками.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  try {
    // --- Резолвим пользователя из JWT, а не доверяем телу запроса ---
    const authHeader = req.headers.get("authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");

    if (!jwt) {
      return json({ error: "not_authenticated" }, 401);
    }

    // anon-клиент нужен именно для валидации токена пользователя,
    // а не service role — так мы проверяем, что токен реально валиден.
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authData, error: authError } = await authClient.auth.getUser(jwt);
    if (authError || !authData?.user) {
      return json({ error: "invalid_session" }, 401);
    }

    const authUser = authData.user;

    const body = await req.json();
    const kind: "plan" | "addon" = body.kind === "addon" ? "addon" : "plan";
    const token = body.token ?? "USDC";

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // --- Резолвим цену и метаданные заказа в зависимости от kind ---------
    let base_amount_cents: number;
    let plan_id: string | null = null;
    let addon_kind: "order" | "subscription" | null = null;
    let addon_slug: string | null = null;

    if (kind === "plan") {
      const { plan_id: requestedPlanId } = body;

      if (!requestedPlanId || typeof requestedPlanId !== "string") {
        return json({ error: "missing_plan" }, 400);
      }

      // Цену берём ТОЛЬКО из БД по plan_id — клиент цену не задаёт.
      const { data: plan, error: planError } = await admin
        .from("plans")
        .select("id, display_name, base_amount_cents, is_active")
        .eq("id", requestedPlanId)
        .maybeSingle();

      if (planError) throw planError;

      if (!plan || !plan.is_active) {
        return json({ error: "invalid_plan" }, 400);
      }

      base_amount_cents = plan.base_amount_cents;
      plan_id = plan.id;
    } else {
      const { addon_slug: requestedSlug } = body;

      if (!requestedSlug || typeof requestedSlug !== "string" || !ADDON_CATALOG[requestedSlug]) {
        return json({ error: "invalid_addon" }, 400);
      }

      // addon_kind тоже берём ТОЛЬКО из каталога — то, что прислал клиент
      // в body.addon_kind, ни на цену, ни на записываемый kind не влияет.
      const catalogEntry = ADDON_CATALOG[requestedSlug];
      base_amount_cents = catalogEntry.base_amount_cents;
      addon_kind = catalogEntry.addon_kind;
      addon_slug = requestedSlug;
    }

    // Находим соответствующую запись в public.users по auth_user_id.
    // Если её ещё нет (гонка с триггером при только что созданном аккаунте) —
    // пробуем найти по email как запасной вариант.
    let { data: profile, error: profileError } = await admin
      .from("users")
      .select("id")
      .eq("auth_user_id", authUser.id)
      .maybeSingle();

    if (!profile && authUser.email) {
      const fallback = await admin
        .from("users")
        .select("id")
        .eq("email", authUser.email)
        .maybeSingle();
      profile = fallback.data;
      profileError = fallback.error;
    }

    if (profileError) throw profileError;

    if (!profile) {
      // Race with the just-signed-up trigger — client should retry shortly.
      return json({ error: "profile_not_ready" }, 409);
    }

    const user_id = profile.id;

    // Пытаемся найти свободный "хвост" центов 0..99.
    // Коллизии по exact_amount_cents исключены уникальным индексом
    // orders_pending_amount_unique (общий на все pending-заказы, вне
    // зависимости от kind) — просто ретраим на конфликте.
    let lastError: unknown = null;

    for (let attempt = 0; attempt < MAX_OFFSET_ATTEMPTS; attempt++) {
      const centsOffset = Math.floor(Math.random() * 100); // 0..99

      const { data, error } = await admin
        .from("orders")
        .insert({
          user_id,
          plan_id,
          kind,
          addon_kind,
          addon_slug,
          base_amount_cents,
          cents_offset: centsOffset,
          token,
          chain: "polygon",
          receiving_wallet: RECEIVING_WALLET,
          status: "pending",
          expires_at: new Date(Date.now() + ORDER_TTL_MINUTES * 60_000).toISOString(),
        })
        .select("id, exact_amount_cents, receiving_wallet, token, chain, expires_at")
        .single();

      if (!error) {
        return json({
          order_id: data.id,
          // Сумму, которую должен отправить пользователь, отдаём в decimal-виде
          // только на этом последнем шаге форматирования — вся логика внутри в центах.
          amount_to_send: (data.exact_amount_cents / 100).toFixed(2),
          token: data.token,
          chain: data.chain,
          receiving_wallet: data.receiving_wallet,
          expires_at: data.expires_at,
        });
      }

      // 23505 = unique_violation -> кто-то уже занял этот "хвост", пробуем другой
      if ((error as { code?: string }).code === "23505") {
        lastError = error;
        continue;
      }

      throw error;
    }

    console.error("create-order: exhausted attempts", lastError);
    return json({ error: "amount_reservation_failed" }, 503);
  } catch (err) {
    console.error("create-order error", err);
    return json({ error: "internal_error" }, 500);
  }
});