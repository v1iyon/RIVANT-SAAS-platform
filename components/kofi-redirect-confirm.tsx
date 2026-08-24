"use client";

// components/kofi-redirect-confirm.tsx
//
// Short warning shown right before handing off to Ko-fi checkout.
// Reason: Ko-fi's cart is persistent and invisible to our site — if a user
// opens one Shop Item link, doesn't finish paying, then opens another,
// the second item gets added to the SAME cart (confirmed real case, see
// kofi-webhook's v2 changelog: Starter Plan + AI Performance Digest x2 in
// one checkout). This is a lightweight nudge to catch that before payment,
// not a full cart preview (we don't have access to Ko-fi's cart state).
//
// Reused from both PaymentModal.tsx (plans) and the addon buy button —
// pass whatever itemName/priceLabel makes sense for that caller.
//
// Locale rule: en / uk / de only, matches the rest of the payment flow
// (PaymentModal, CryptoCheckoutModal) — no Russian anywhere in this UI.

import { AlertTriangle } from "lucide-react";

type Locale = "en" | "uk" | "de";

const TEXT: Record<Locale, { warning: string; cancel: string; confirm: string }> = {
  en: {
    warning: "Check your Ko-fi cart before paying — old items may still be in it.",
    cancel: "Cancel",
    confirm: "Go to checkout",
  },
  uk: {
    warning: "Перевірте кошик на Ko-fi перед оплатою — там можуть залишитись старі товари.",
    cancel: "Скасувати",
    confirm: "Перейти до оплати",
  },
  de: {
    warning: "Prüfen Sie Ihren Ko-fi-Warenkorb vor der Zahlung — alte Artikel könnten noch enthalten sein.",
    cancel: "Abbrechen",
    confirm: "Zur Kasse",
  },
};

interface KofiRedirectConfirmProps {
  itemName: string;
  priceLabel: string;
  locale: Locale;
  onConfirm: () => void;
  onCancel: () => void;
}

export function KofiRedirectConfirm({
  itemName,
  priceLabel,
  locale,
  onConfirm,
  onCancel,
}: KofiRedirectConfirmProps) {
  const t = TEXT[locale];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#12121a] p-6 text-[#f4f4f6]">
        <p className="font-medium">{itemName}</p>
        <p className="mb-4 text-sm text-slate-400">{priceLabel}</p>

        <div className="mb-5 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-400" />
          <span className="text-xs leading-snug text-amber-300">{t.warning}</span>
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white"
          >
            {t.cancel}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
            style={{ background: "linear-gradient(135deg, #4f7cff 0%, #6f5bff 100%)" }}
          >
            {t.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}