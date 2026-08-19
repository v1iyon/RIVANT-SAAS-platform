"use client";

// components/PaymentModal.tsx
//
// Payment flow via our own Polygon wallet listener:
//   - Clicking a plan calls `create-order`, which reserves a unique
//     salted amount and returns { order_id, amount_to_send, token,
//     chain, receiving_wallet, expires_at }.
//   - We show that wallet address + exact amount right here in the modal
//     (with copy buttons) instead of opening any external checkout page.
//   - The user sends the payment manually from their own wallet.
//   - Confirmation is exclusively the on-chain webhook (polygon-webhook)
//     watching the receiving wallet, surfaced via useOrderStatus
//     (Realtime + polling fallback).

import { useState, useCallback, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { useOrderStatus } from "@/hooks/useOrderStatus";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export interface PlanOption {
  id: string; // must match public.plans.id, e.g. "starter" | "growth" | "premium"
  label: string;
  priceDisplay: string; // e.g. "$99/mo" — purely cosmetic, real price is server-side
}

interface PaymentModalProps {
  plan: PlanOption;
  open: boolean;
  onClose: () => void;
  onPaid?: () => void;
}

interface CryptoOrder {
  order_id: string;
  amount_to_send: string; // e.g. "99.42"
  token: string; // "USDC"
  chain: string; // "polygon"
  receiving_wallet: string;
  expires_at: string;
}

type FlowState = "idle" | "creating_order" | "awaiting_payment" | "paid" | "error" | "timed_out";

const TEXT = {
  waiting: {
    ua: "Очікуємо підтвердження оплати в блокчейні. Це може зайняти кілька хвилин після відправки.",
    en: "Waiting for on-chain payment confirmation. This can take a few minutes after you send it.",
    de: "Wir warten auf die Bestätigung der Zahlung in der Blockchain. Das kann nach dem Senden einige Minuten dauern.",
  },
  sendExactly: {
    ua: "Надішліть рівно цю суму на адресу нижче:",
    en: "Send exactly this amount to the address below:",
    de: "Senden Sie genau diesen Betrag an die untenstehende Adresse:",
  },
  networkNote: {
    ua: "Тільки в мережі Polygon. Перевірте мережу перед відправкою.",
    en: "Polygon network only. Please double-check the network before sending.",
    de: "Nur im Polygon-Netzwerk. Bitte überprüfen Sie das Netzwerk vor dem Senden.",
  },
  copy: { ua: "Копіювати", en: "Copy", de: "Kopieren" },
  copied: { ua: "Скопійовано", en: "Copied", de: "Kopiert" },
  expiresIn: { ua: "Термін дії:", en: "Expires in:", de: "Läuft ab in:" },
  paidTitle: { ua: "Оплату підтверджено", en: "Payment confirmed", de: "Zahlung bestätigt" },
  continue: { ua: "Продовжити", en: "Continue", de: "Weiter" },
  timedOutTitle: { ua: "Час очікування вийшов", en: "Payment window expired", de: "Zahlungsfenster abgelaufen" },
  timedOutBody: {
    ua: "Сесія оплати завершилась до підтвердження платежу.",
    en: "The checkout session timed out before payment was confirmed.",
    de: "Die Zahlungssitzung ist abgelaufen, bevor die Zahlung bestätigt wurde.",
  },
  tryAgain: { ua: "Спробувати ще раз", en: "Try again", de: "Erneut versuchen" },
  errorTitle: { ua: "Щось пішло не так", en: "Something went wrong", de: "Etwas ist schiefgelaufen" },
  errorBody: {
    ua: "Не вдалося створити замовлення на оплату. Спробуйте ще раз.",
    en: "We couldn't start the checkout. Please try again.",
    de: "Der Checkout konnte nicht gestartet werden. Bitte versuchen Sie es erneut.",
  },
} as const;

export function PaymentModal({ plan, open, onClose, onPaid }: PaymentModalProps) {
  const [flowState, setFlowState] = useState<FlowState>("idle");
  const [order, setOrder] = useState<CryptoOrder | null>(null);
  const [copiedField, setCopiedField] = useState<"address" | "amount" | null>(null);

  const { status: orderStatus } = useOrderStatus(order?.order_id ?? null);

  const startCheckout = useCallback(async () => {
    setFlowState("creating_order");

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
          body: JSON.stringify({ plan_id: plan.id }),
        },
      );

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `request_failed_${res.status}`);
      }

      const data: CryptoOrder = await res.json();
      setOrder(data);
      setFlowState("awaiting_payment");
    } catch (err) {
      console.error("checkout failed", err);
      setFlowState("error");
    }
  }, [plan.id]);

  useEffect(() => {
    if (!open) {
      setFlowState("idle");
      setOrder(null);
      setCopiedField(null);
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

  const copyToClipboard = useCallback(async (value: string, field: "address" | "amount") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error("clipboard write failed", err);
    }
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 p-8 shadow-2xl">
        {flowState === "creating_order" && (
          <div className="flex flex-col items-center gap-6 text-center py-6">
            <Spinner />
          </div>
        )}

        {flowState === "awaiting_payment" && order && (
          <div className="flex flex-col gap-5 text-center">
            <p className="text-sm text-zinc-300">{TEXT.sendExactly.ua}</p>
            <p className="text-sm text-zinc-300">{TEXT.sendExactly.en}</p>
            <p className="text-sm text-zinc-300">{TEXT.sendExactly.de}</p>

            <div className="rounded-xl border border-white/10 bg-zinc-900 p-4">
              <p className="text-2xl font-semibold text-white">
                {order.amount_to_send} {order.token}
              </p>
              <button
                onClick={() => copyToClipboard(order.amount_to_send, "amount")}
                className="mt-2 text-xs text-blue-400 hover:text-blue-300"
              >
                {copiedField === "amount" ? TEXT.copied.en : TEXT.copy.en}
              </button>
            </div>

            <div className="rounded-xl border border-white/10 bg-zinc-900 p-4">
              <p className="break-all font-mono text-sm text-zinc-200">
                {order.receiving_wallet}
              </p>
              <button
                onClick={() => copyToClipboard(order.receiving_wallet, "address")}
                className="mt-2 text-xs text-blue-400 hover:text-blue-300"
              >
                {copiedField === "address" ? TEXT.copied.en : TEXT.copy.en}
              </button>
            </div>

            <p className="text-xs text-amber-400">{TEXT.networkNote.en}</p>
            <p className="text-xs text-amber-400">{TEXT.networkNote.ua}</p>
            <p className="text-xs text-amber-400">{TEXT.networkNote.de}</p>

            <div className="flex items-center justify-center gap-3 pt-2">
              <Spinner small />
              <p className="text-xs text-zinc-400">{TEXT.waiting.en}</p>
            </div>

            <CountdownLabel expiresAt={order.expires_at} />
          </div>
        )}

        {flowState === "paid" && (
          <div className="flex flex-col items-center gap-4 text-center">
            <CheckIcon />
            <p className="text-lg font-medium text-white">{TEXT.paidTitle.en}</p>
            <button
              onClick={onClose}
              className="mt-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-500"
            >
              {TEXT.continue.en}
            </button>
          </div>
        )}

        {flowState === "timed_out" && (
          <div className="flex flex-col items-center gap-4 text-center">
            <p className="text-lg font-medium text-white">{TEXT.timedOutTitle.en}</p>
            <p className="text-sm text-zinc-400">{TEXT.timedOutBody.en}</p>
            <button
              onClick={startCheckout}
              className="mt-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-500"
            >
              {TEXT.tryAgain.en}
            </button>
          </div>
        )}

        {flowState === "error" && (
          <div className="flex flex-col items-center gap-4 text-center">
            <p className="text-lg font-medium text-white">{TEXT.errorTitle.en}</p>
            <p className="text-sm text-zinc-400">{TEXT.errorBody.en}</p>
            <button
              onClick={startCheckout}
              className="mt-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-500"
            >
              {TEXT.tryAgain.en}
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

function CountdownLabel({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState<string>("");

  useEffect(() => {
    const target = new Date(expiresAt).getTime();

    const tick = () => {
      const diffMs = target - Date.now();
      if (diffMs <= 0) {
        setRemaining("00:00");
        return;
      }
      const totalSeconds = Math.floor(diffMs / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      setRemaining(`${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  return (
    <p className="text-xs text-zinc-500">
      {TEXT.expiresIn.en} <span className="font-mono text-zinc-300">{remaining}</span>
    </p>
  );
}

function Spinner({ small = false }: { small?: boolean }) {
  return (
    <div
      className={`animate-spin rounded-full border-2 border-zinc-700 border-t-blue-500 ${
        small ? "h-5 w-5" : "h-10 w-10"
      }`}
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