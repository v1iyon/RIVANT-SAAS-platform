"use client";

// hooks/use-addon-subscription-status.ts
//
// Watches public.addon_subscriptions for one (business_id, addon_type)
// pair and reports whether it's active. Same shape as the
// subscriptions-watch effect in PaymentModal.tsx (Realtime UPDATE/INSERT
// listener + a poll fallback in case a Realtime event gets missed), just
// pointed at a different table/filter — see plan.md's note that this
// should copy that logic 1:1 rather than invent a new pattern.
//
// Scope: monthly/recurring addons only (monthly_digest, team_alerts) —
// anything that lives in addon_subscriptions and has a real 'active'
// status to wait for. One-time services (whatif_analysis) live in
// service_orders instead and don't need Realtime waiting the same way
// (per plan.md: for those we just confirm "order created", not an
// instant activation) — that's a separate, simpler confirmation, not
// this hook.
//
// Poll interval: 3–5s per plan.md (shorter than PaymentModal's 15s
// subscriptions poll) since addon confirmation is expected to feel
// snappier right after a payment.
//
// Usage:
//   const { status, isActive, currentPeriodEnd } =
//     useAddonSubscriptionStatus(businessId, "monthly_digest");

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

export type AddonType = "monthly_digest" | "team_alerts" | (string & {});

export type AddonSubscriptionStatus = "pending" | "active" | "expired" | "unknown";

interface AddonSubscriptionRow {
  business_id: string;
  addon_type: string;
  status: string;
  current_period_end: string | null;
}

interface UseAddonSubscriptionStatusResult {
  status: AddonSubscriptionStatus;
  isActive: boolean;
  currentPeriodEnd: string | null;
}

const POLL_INTERVAL_MS = 4000;

export function useAddonSubscriptionStatus(
  businessId: string | null | undefined,
  addonType: AddonType,
): UseAddonSubscriptionStatusResult {
  const [status, setStatus] = useState<AddonSubscriptionStatus>("pending");
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);
  const supabase = useRef(createClient()).current;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const applyRow = (row: AddonSubscriptionRow | null) => {
    if (!row) return;
    if (row.status === "active") {
      setStatus("active");
      setCurrentPeriodEnd(row.current_period_end);
      stopPolling();
    } else if (row.status === "expired" || row.status === "cancelled") {
      setStatus("expired");
      setCurrentPeriodEnd(row.current_period_end);
    }
  };

  const checkOnce = async () => {
    if (!businessId) return;
    const { data, error } = await supabase
      .from("addon_subscriptions")
      .select("business_id, addon_type, status, current_period_end")
      .eq("business_id", businessId)
      .eq("addon_type", addonType)
      .maybeSingle();

    if (error) {
      console.error("[useAddonSubscriptionStatus] poll check failed", error);
      return;
    }
    applyRow(data as AddonSubscriptionRow | null);
  };

  useEffect(() => {
    if (!businessId) {
      setStatus("unknown");
      return;
    }

    // Reset for a fresh (businessId, addonType) pair — otherwise a stale
    // "active" from a previous addon could flash before the first check.
    setStatus("pending");
    setCurrentPeriodEnd(null);

    // Check immediately in case the row is already active by the time
    // this mounts (e.g. webhook beat the UI to it).
    checkOnce();

    const channel = supabase
      .channel(`addon_${businessId}_${addonType}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "addon_subscriptions",
          filter: `business_id=eq.${businessId}`,
        },
        (payload) => {
          const row = payload.new as AddonSubscriptionRow;
          if (row?.addon_type === addonType) applyRow(row);
        },
      )
      .subscribe();

    pollRef.current = setInterval(checkOnce, POLL_INTERVAL_MS);

    return () => {
      supabase.removeChannel(channel);
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, addonType]);

  return { status, isActive: status === "active", currentPeriodEnd };
}