"use client";

// Calls the create-order Edge Function and returns data for the payment
// window. The user is resolved server-side from the session token
// (Authorization: Bearer <access_token>) — never passed manually.
//
// The price is looked up server-side from public.plans by plan_id — the
// client only ever sends which plan was picked, never an amount.

import { createClient } from "@/lib/supabase-browser";

export interface CryptoOrder {
  order_id: string;
  amount_to_send: string; // e.g. "99.42"
  token: string; // "USDC"
  chain: string; // "polygon"
  receiving_wallet: string;
  expires_at: string;
}

export async function createCryptoOrder({
  planId,
  token = "USDC",
}: {
  planId: string;
  token?: string;
}): Promise<CryptoOrder> {
  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("not_authenticated");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  const res = await fetch(`${supabaseUrl}/functions/v1/create-order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      plan_id: planId,
      token,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "order_creation_failed");
  }

  return res.json();
}