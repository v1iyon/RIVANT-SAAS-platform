// supabase/functions/create-order/index.ts
//
// Вызывается фронтендом при открытии окна оплаты.
// Атомарно резервирует уникальную "сумму с хвостом центов",
// чтобы два параллельных покупателя одного и того же тарифа
// никогда не получили одинаковую exact_amount_cents, пока их заказы pending.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RECEIVING_WALLET = Deno.env.get("POLYGON_RECEIVING_WALLET")!; // один общий адрес
const ORDER_TTL_MINUTES = 30;
const MAX_ATTEMPTS = 25;

// Разрешаем браузеру вызывать эту функцию напрямую с вашего сайта.
// Без этих заголовков Chrome блокирует ответ ещё до того, как код
// на странице успевает его увидеть (ошибка CORS).
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
      return json({ error: "Требуется авторизация" }, 401);
    }

    // anon-клиент нужен именно для валидации токена пользователя,
    // а не service role — так мы проверяем, что токен реально валиден.
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authData, error: authError } = await authClient.auth.getUser(jwt);
    if (authError || !authData?.user) {
      return json({ error: "Невалидная сессия" }, 401);
    }

    const authUser = authData.user;

    const { base_amount_cents, token = "USDC" } = await req.json();

    if (!Number.isInteger(base_amount_cents) || base_amount_cents <= 0) {
      return json({ error: "base_amount_cents (int, в центах) обязателен" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Находим соответствующую запись в public.users по auth_user_id.
    // Если её ещё нет (гонка с триггером при только что созданном аккаунте) —
    // пробуем найти по email как запасной вариант.
    let { data: profile, error: profileError } = await supabase
      .from("users")
      .select("id")
      .eq("auth_user_id", authUser.id)
      .maybeSingle();

    if (!profile && authUser.email) {
      const fallback = await supabase
        .from("users")
        .select("id")
        .eq("email", authUser.email)
        .maybeSingle();
      profile = fallback.data;
      profileError = fallback.error;
    }

    if (profileError) throw profileError;

    if (!profile) {
      return json(
        { error: "Профиль пользователя ещё не создан, попробуйте через несколько секунд" },
        409,
      );
    }

    const user_id = profile.id;

    // Пытаемся найти свободный "хвост" центов 0..99.
    // Коллизии по exact_amount_cents исключены уникальным индексом
    // orders_pending_amount_unique — просто ретраим на конфликте.
    let lastError: unknown = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const centsOffset = Math.floor(Math.random() * 100); // 0..99

      const { data, error } = await supabase
        .from("orders")
        .insert({
          user_id,
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
    return json(
      { error: "Не удалось выделить уникальную сумму, попробуйте ещё раз через минуту" },
      503,
    );
  } catch (err) {
    console.error("create-order error", err);
    return json({ error: "internal_error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}