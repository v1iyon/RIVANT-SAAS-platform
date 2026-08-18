// supabase/functions/polygon-webhook/index.ts
//
// Принимает webhook от Alchemy "Address Activity" (бесплатный тариф Alchemy
// хватает для старта, лимит по запросам щедрый). Это надёжнее и дешевле,
// чем поллинг блокчейна из cron-джобы: Alchemy сам следит за нодой и
// присылает событие сразу же, как транзакция попала в блок.
//
// Настройка на стороне Alchemy:
//   Dashboard -> Notify -> Create Webhook -> Address Activity
//   Network: Polygon Mainnet
//   Addresses: [ваш RECEIVING_WALLET]
//   Webhook URL: https://<project>.supabase.co/functions/v1/polygon-webhook
//   Скопируйте "Signing Key" в ALCHEMY_SIGNING_KEY
//
// Токен по умолчанию: USDC на Polygon (6 знаков после запятой / decimals=6).
// Если принимаете ещё и USDT — добавьте его адрес в TOKEN_DECIMALS.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALCHEMY_SIGNING_KEY = Deno.env.get("ALCHEMY_SIGNING_KEY")!;
const RECEIVING_WALLET = Deno.env.get("POLYGON_RECEIVING_WALLET")!.toLowerCase();

// contract_address (lowercase) -> { symbol, decimals }
const TOKEN_DECIMALS: Record<string, { symbol: string; decimals: number }> = {
  "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": { symbol: "USDC", decimals: 6 }, // native USDC на Polygon
  "0xc2132d05d31c914a87c6611c10748aeb04b58e8f": { symbol: "USDT", decimals: 6 },
};

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const rawBody = await req.text();

  // --- 1. Проверяем подпись, иначе кто угодно сможет "прислать" фейковый платёж ---
  const signature = req.headers.get("x-alchemy-signature");
  const valid = await verifySignature(rawBody, signature, ALCHEMY_SIGNING_KEY);
  if (!valid) {
    console.warn("polygon-webhook: invalid signature");
    return new Response("Invalid signature", { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const activities = payload?.event?.activity ?? [];

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const results: unknown[] = [];

  for (const activity of activities) {
    results.push(await handleActivity(supabase, activity));
  }

  return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

async function handleActivity(
  supabase: ReturnType<typeof createClient>,
  activity: any,
) {
  try {
    const toAddress = (activity.toAddress ?? "").toLowerCase();
    if (toAddress !== RECEIVING_WALLET) {
      return { skipped: "not_our_wallet" };
    }

    const txHash: string | undefined = activity.hash;
    if (!txHash) return { skipped: "no_hash" };

    // --- 2. Определяем токен и переводим сумму из минимальных единиц в центы ---
    let amountCents: number;
    let tokenSymbol: string;

    if (activity.category === "erc20" && activity.rawContract?.address) {
      const contract = activity.rawContract.address.toLowerCase();
      const meta = TOKEN_DECIMALS[contract];
      if (!meta) return { skipped: "unsupported_token", contract };

      const rawValue: string = activity.rawContract.rawValue; // hex string, минимальные единицы токена
      const units = BigInt(rawValue);
      const divisor = 10n ** BigInt(meta.decimals - 2); // -2, потому что нам нужны ЦЕНТЫ, не доллары
      amountCents = Number(units / divisor);
      tokenSymbol = meta.symbol;
    } else {
      // Нативный MATIC/POL как оплату не принимаем — слишком волатилен для
      // точного центового мэтчинга. Пропускаем.
      return { skipped: "not_erc20" };
    }

    // --- 3. Анти-фрод: этот tx_hash уже где-то засчитан? ---
    const { data: existing } = await supabase
      .from("orders")
      .select("id")
      .eq("tx_hash", txHash)
      .maybeSingle();

    if (existing) {
      return { skipped: "tx_already_processed", txHash };
    }

    const txBlockTime = activity.blockTimestamp
      ? new Date(activity.blockTimestamp)
      : new Date();

    // --- 4. Ищем pending-заказ на эту сумму, СОЗДАННЫЙ ДО транзакции ---
    // created_at < tx_block_time — критично: без этого условия можно
    // подсмотреть чужую входящую транзакцию и быстро создать заказ на
    // ту же сумму, перехватив чужой платёж.
    const { data: order, error: findError } = await supabase
      .from("orders")
      .select("*")
      .eq("exact_amount_cents", amountCents)
      .eq("status", "pending")
      .lt("created_at", txBlockTime.toISOString())
      .gt("expires_at", txBlockTime.toISOString())
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (findError) throw findError;

    if (!order) {
      // Деньги пришли, а подходящего заказа нет — не теряем их молча.
      await supabase.from("unmatched_payments").insert({
        tx_hash: txHash,
        amount_cents: amountCents,
        token: tokenSymbol,
        raw_activity: activity,
      });
      return { skipped: "no_matching_order", amountCents, txHash };
    }

    // --- 5. Атомарно закрываем заказ: UPDATE ... WHERE status='pending' ---
    // Условие status='pending' в WHERE — это и есть защита от гонки, если
    // вебхук вдруг придёт дважды параллельно.
    const { data: updatedOrder, error: updateError } = await supabase
      .from("orders")
      .update({
        status: "success",
        tx_hash: txHash,
        matched_at: new Date().toISOString(),
        tx_block_time: txBlockTime.toISOString(),
      })
      .eq("id", order.id)
      .eq("status", "pending")
      .select()
      .single();

    if (updateError) {
      // Уникальный индекс по tx_hash или гонка по статусу — заказ уже кем-то закрыт
      console.error("order update race/conflict", updateError);
      return { skipped: "update_conflict", orderId: order.id };
    }

    // --- 6. Продлеваем подписку пользователя ---
    const { data: userRow, error: userFetchError } = await supabase
      .from("users")
      .select("subscription_expires_at")
      .eq("id", updatedOrder.user_id)
      .single();

    if (userFetchError) throw userFetchError;

    const now = new Date();
    const currentExpiry = userRow.subscription_expires_at
      ? new Date(userRow.subscription_expires_at)
      : now;
    // Если подписка ещё активна — продлеваем от даты её окончания,
    // а не "затираем" оставшиеся дни, продлевая от "сейчас".
    const base = currentExpiry > now ? currentExpiry : now;
    const newExpiry = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);

    const { error: userUpdateError } = await supabase
      .from("users")
      .update({
        has_active_subscription: true,
        subscription_expires_at: newExpiry.toISOString(),
      })
      .eq("id", updatedOrder.user_id);

    if (userUpdateError) throw userUpdateError;

    // Фронтенду ничего вручную слать не нужно: он подписан через
    // supabase.channel(...).on('postgres_changes', ...) на этот order.id,
    // и update() выше сам придёт клиенту через Realtime.

    return { matched: true, orderId: updatedOrder.id, amountCents, txHash };
  } catch (err) {
    console.error("handleActivity error", err);
    return { error: String(err) };
  }
}

async function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  signingKey: string,
): Promise<boolean> {
  if (!signatureHeader) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const computedHex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(computedHex, signatureHeader);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
