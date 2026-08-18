// lib/use-order-status.ts
//
// Использование в компоненте окна оплаты:
//
//   const { order, status } = useOrderStatus(orderId, supabase);
//   useEffect(() => {
//     if (status === "success") closePaymentModal();
//   }, [status]);

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export type OrderStatus = "pending" | "success" | "expired" | "fraud_flagged";

export interface OrderRow {
  id: string;
  status: OrderStatus;
  exact_amount_cents: number;
  receiving_wallet: string;
  token: string;
  chain: string;
  expires_at: string;
  tx_hash: string | null;
}

export function useOrderStatus(orderId: string | null, supabase: SupabaseClient) {
  const [order, setOrder] = useState<OrderRow | null>(null);

  useEffect(() => {
    if (!orderId) return;

    let cancelled = false;

    // Забираем текущее состояние сразу (на случай, если оплата
    // прошла до того, как подписка успела установиться).
    supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single()
      .then(({ data }) => {
        if (!cancelled && data) setOrder(data as OrderRow);
      });

    const channel = supabase
      .channel(`order-${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `id=eq.${orderId}`,
        },
        (payload) => {
          setOrder(payload.new as OrderRow);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [orderId, supabase]);

  return { order, status: order?.status ?? "pending" };
}
