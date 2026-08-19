"use client";

// components/PaymentModal.tsx
//
// Payment flow via Changelly Affiliate Widget:
//   - No wallet address or amount shown anywhere in this component.
//   - Clicking a plan calls `create-order`, which returns a ready-to-open
//     Changelly widget URL (wallet address + exact salted amount already
//     baked in server-side).
//   - That URL opens in a new browser tab via window.open — not an iframe.
//   - The modal itself just shows a loader and waits for `polygon-webhook`
//     to confirm payment, via useOrderStatus (Realtime + polling fallback).
//     Changelly's widget has no callback to our backend, so confirmation is
//     still exclusively the on-chain webhook watching the wallet.

import { useState, useCallback, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { useOrderStatus } from "@/hooks/useOrderStatus";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export interface PlanOption {
  id: string; // e.g. "starter" | "growth" | "premium"
  label: string;
  priceDisplay: string; // e.g. "$299/mo" — purely cosmetic, real price is server-side
}

interface PaymentModalProps {
  plan: PlanOption;
  open: boolean;
  onClose: () => void;
  onPaid?: () => void;
}

type FlowState = "idle" | "creating_order" | "awaiting_payment" | "paid" | "error" | "timed_out";

const WAITING_TEXT = {
  ua: "Очікуємо підтвердження оплати від процесингу... Будь ласка, не закривайте цю сторінку.",
  en: "Waiting for payment confirmation from the processor... Please don't close this page.",
  ru: "Ожидаем подтверждения оплаты от процессинга... Пожалуйста, не закрывайте эту страницу.",
};

export function PaymentModal({ plan, open, onClose, onPaid }: PaymentModalProps) {
  const [flowState, setFlowState] = useState<FlowState>("idle");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { status: orderStatus } = useOrderStatus(orderId);

  const startCheckout = useCallback(async () => {
    setFlowState("creating_order");
    setErrorMessage(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error("not_authenticated");
      }

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-order`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ plan: plan.id }),
        },
      );

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `request_failed_${res.status}`);
      }

      const { order, widgetUrl } = await res.json();

      setOrderId(order.id);
      setFlowState("awaiting_payment");

      // New tab, not an iframe — Changelly's widget can be framed, but a
      // full tab avoids any embedding restrictions and gives the user a
      // normal, trusted browser chrome for entering card details.
      const paymentWindow = window.open(widgetUrl, "_blank", "noopener");
      if (!paymentWindow) {
        setErrorMessage("popup_blocked");
      }
    } catch (err) {
      console.error("checkout failed", err);
      setFlowState("error");
      setErrorMessage(err instanceof Error ? err.message : "unknown_error");
    }
  }, [plan.id]);

  useEffect(() => {
    if (!open) {
      setFlowState("idle");
      setOrderId(null);
      setErrorMessage(null);
    }
  }, [open]);

  useEffect(() => {
    if (orderStatus === "paid") {
      setFlowState("paid");
      onPaid?.();
    } else if (orderStatus === "timed_out" || orderStatus === "expired") {
      setFlowState("timed_out");
    }
  }, [orderStatus, onPaid]);

  useEffect(() => {
    if (open && flowState === "idle") {
      startCheckout();
    }
  }, [open, flowState, startCheckout]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 p-8 shadow-2xl">
        {(flowState === "creating_order" || flowState === "awaiting_payment") && (
          <div className="flex flex-col items-center gap-6 text-center">
            <Spinner />
            <div className="space-y-3 text-sm leading-relaxed text-zinc-300">
              <p>{WAITING_TEXT.ua}</p>
              <p>{WAITING_TEXT.en}</p>
              <p>{WAITING_TEXT.ru}</p>
            </div>
            {flowState === "awaiting_payment" && (
              <button
                onClick={startCheckout}
                className="text-xs text-zinc-500 underline underline-offset-4 hover:text-zinc-300"
              >
                Didn't see the payment tab open? Click here to retry
              </button>
            )}
          </div>
        )}

        {flowState === "paid" && (
          <div className="flex flex-col items-center gap-4 text-center">
            <CheckIcon />
            <p className="text-lg font-medium text-white">Payment confirmed</p>
            <button
              onClick={onClose}
              className="mt-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-500"
            >
              Continue
            </button>
          </div>
        )}

        {flowState === "timed_out" && (
          <div className="flex flex-col items-center gap-4 text-center">
            <p className="text-lg font-medium text-white">Payment window expired</p>
            <p className="text-sm text-zinc-400">
              The checkout session timed out before payment was confirmed.
            </p>
            <button
              onClick={startCheckout}
              className="mt-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-500"
            >
              Try again
            </button>
          </div>
        )}

        {flowState === "error" && (
          <div className="flex flex-col items-center gap-4 text-center">
            <p className="text-lg font-medium text-white">Something went wrong</p>
            <p className="text-sm text-zinc-400">
              {errorMessage === "popup_blocked"
                ? "Your browser blocked the payment tab. Please allow pop-ups for this site and try again."
                : "We couldn't start the checkout. Please try again."}
            </p>
            <button
              onClick={startCheckout}
              className="mt-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-500"
            >
              Try again
            </button>
          </div>
        )}

        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-zinc-500 hover:text-zinc-300"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div
      className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-700 border-t-blue-500"
      role="status"
      aria-label="Loading"
    />
  );
}

function CheckIcon() {
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
      <svg viewBox="0 0 24 24" className="h-6 w-6 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </div>
  );
}