"use client";

// Вызывает Edge Function create-order и возвращает данные для окна оплаты.
// Использует те же переменные окружения, что и supabase-browser.ts,
// так что отдельно ничего настраивать не нужно, если авторизация уже работает.

export interface CryptoOrder {
  order_id: string;
  amount_to_send: string; // например "99.42"
  token: string;          // "USDC"
  chain: string;          // "polygon"
  receiving_wallet: string;
  expires_at: string;
}

export async function createCryptoOrder({
  userId,
  baseAmountCents,
  token = "USDC",
}: {
  userId: string;
  baseAmountCents: number;
  token?: string;
}): Promise<CryptoOrder> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const res = await fetch(`${supabaseUrl}/functions/v1/create-order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({
      user_id: userId,
      base_amount_cents: baseAmountCents,
      token,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Не удалось создать заказ на оплату");
  }

  return res.json();
}
