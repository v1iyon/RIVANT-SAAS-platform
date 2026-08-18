"use client";

// Вызывает Edge Function create-order и возвращает данные для окна оплаты.
// user_id больше не передаётся вручную — функция сама определяет пользователя
// по токену сессии (Authorization: Bearer <access_token>).

import { createClient } from "@/lib/supabase-browser";

export interface CryptoOrder {
  order_id: string;
  amount_to_send: string; // например "99.42"
  token: string;          // "USDC"
  chain: string;          // "polygon"
  receiving_wallet: string;
  expires_at: string;
}

export async function createCryptoOrder({
  baseAmountCents,
  token = "USDC",
}: {
  baseAmountCents: number;
  token?: string;
}): Promise<CryptoOrder> {
  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("Вы не авторизованы");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  const res = await fetch(`${supabaseUrl}/functions/v1/create-order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
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