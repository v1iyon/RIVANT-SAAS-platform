// hooks/useOrderStatus.ts
//
// Tracks a pending crypto order to completion:
//   - Supabase Realtime subscription for instant updates
//   - Fallback poll every 15s in case the socket drops (backgrounded mobile
//     browser, flaky network) — Realtime and polling can both fire; state
//     updates are idempotent so that's fine
//   - Local 1s countdown driven by `expires_at`, independent of the network,
//     so the UI flips to "expired" even if both Realtime and polling stall

import { useEffect, useRef, useState, useCallback } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type OrderStatus = "pending" | "paid" | "expired" | "canceled";

export interface OrderRecord {
  id: string;
  status: OrderStatus;
  exact_amount_usdc: string;
  pay_to_address: string;
  chain: string;
  token: string;
  expires_at: string;
}

export interface UseOrderStatusResult {
  order: OrderRecord | null;
  status: OrderStatus | "loading" | "timed_out";
  secondsRemaining: number;
  isExpiredLocally: boolean;
  refetch: () => Promise<void>;
}

const POLL_INTERVAL_MS = 15_000;
const TICK_INTERVAL_MS = 1_000;

function getSupabaseClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export function useOrderStatus(orderId: string | null): UseOrderStatusResult {
  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [loading, setLoading] = useState<boolean>(!!orderId);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(0);
  const [isExpiredLocally, setIsExpiredLocally] = useState<boolean>(false);

  const supabaseRef = useRef<SupabaseClient | null>(null);
  if (!supabaseRef.current) supabaseRef.current = getSupabaseClient();
  const supabase = supabaseRef.current;

  const fetchOrder = useCallback(async () => {
    if (!orderId) return;
    const { data, error } = await supabase
      .from("orders")
      .select("id, status, exact_amount_usdc, pay_to_address, chain, token, expires_at")
      .eq("id", orderId)
      .single();

    if (!error && data) {
      setOrder(data as OrderRecord);
    }
    setLoading(false);
  }, [orderId, supabase]);

  // Initial fetch
  useEffect(() => {
    if (!orderId) return;
    setLoading(true);
    fetchOrder();
  }, [orderId, fetchOrder]);

  // Realtime subscription — instant updates when the webhook marks the
  // order paid (or the cron job marks it expired).
  useEffect(() => {
    if (!orderId) return;

    const channel = supabase
      .channel(`order-status-${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `id=eq.${orderId}`,
        },
        (payload) => {
          setOrder(payload.new as OrderRecord);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orderId, supabase]);

  // Fallback polling — covers dropped sockets (e.g. mobile browser
  // backgrounded and the Realtime websocket got torn down). Stops once the
  // order reaches a terminal state.
  useEffect(() => {
    if (!orderId) return;
    if (order && order.status !== "pending") return; // terminal, no need to poll

    const interval = setInterval(() => {
      // Re-fetch quietly; don't toggle the loading state on background polls.
      fetchOrder();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [orderId, order?.status, fetchOrder]);

  // Local 1s countdown based on expires_at. This is what flips the UI to
  // "time's up" even if Realtime and polling both fail to reach the server —
  // it's a pure client-side clock, not a substitute for server-side expiry.
  useEffect(() => {
    if (!order?.expires_at) return;

    const expiresAtMs = new Date(order.expires_at).getTime();

    const tick = () => {
      const remainingMs = expiresAtMs - Date.now();
      const remainingSec = Math.max(0, Math.floor(remainingMs / 1000));
      setSecondsRemaining(remainingSec);
      if (remainingSec <= 0) {
        setIsExpiredLocally(true);
      }
    };

    tick(); // run immediately so the UI isn't blank for the first second
    const interval = setInterval(tick, TICK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [order?.expires_at]);

  const derivedStatus: UseOrderStatusResult["status"] = (() => {
    if (loading) return "loading";
    if (!order) return "loading";
    if (order.status === "pending" && isExpiredLocally) return "timed_out";
    return order.status;
  })();

  return {
    order,
    status: derivedStatus,
    secondsRemaining,
    isExpiredLocally,
    refetch: fetchOrder,
  };
}
