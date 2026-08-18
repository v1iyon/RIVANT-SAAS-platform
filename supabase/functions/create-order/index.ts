// supabase/functions/create-order/index.ts
//
// Вызывается фронтендом при открытии окна оплаты.
// Атомарно резервирует уникальную "сумму с хвостом центов",
// чтобы два параллельных покупателя одного и того же тарифа
// никогда не получили одинаковую exact_amount_cents, пока их заказы pending.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RECEIVING_WALLET = Deno.env.get("POLYGON_RECEIVING_WALLET")!; // один общий адрес
const ORDER_TTL_MINUTES = 30;
const MAX_ATTEMPTS = 25;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { user_id, base_amount_cents, token = "USDC" } = await req.json();

    if (!user_id || !Number.isInteger(base_amount_cents) || base_amount_cents <= 0) {
      return json({ error: "user_id и base_amount_cents (int, в центах) обязательны" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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
    headers: { "Content-Type": "application/json" },
  });
}
