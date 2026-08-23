"use client";

// frontend/PaymentModal.tsx
//
// Plan picker with two tabs:
//   - "Card / PayPal" -> opens the matching Ko-fi checkout in a centered
//     popup window (falls back to a new tab if the popup is blocked), then
//     waits for kofi-webhook to flip public.subscriptions.access_status
//     to 'active' (Realtime + 15s poll fallback).
//   - "Crypto (USDC / Polygon)" -> calls createCryptoOrder() as soon as the
//     tab is selected (when initialPlan is known) and mounts the existing
//     CryptoCheckoutModal, which owns its own waiting/expiry UI via
//     useOrderStatus().
//
// Locales: en / uk / de only (no Russian — matches the site-wide rule).
// Plan ids match public.plans: "starter" | "growth" | "premium" (the
// user-facing "Scale" tier's DB id is "premium", not "scale").
//
// Ko-fi Shop Item links are wired in below as DEFAULT_KOFI_LINKS. The
// kofi-webhook matches these by direct_link_code (the part after /s/ in
// the URL) — if you regenerate a Shop Item link in Ko-fi, its code changes
// and BOTH this file and kofi-webhook's DIRECT_LINK_CODE_TO_PLAN_ID need
// updating.
//
// CHANGELOG (this fix):
//   1. Crypto tab now fires createCryptoOrder() the moment the tab is
//      clicked (when initialPlan is set), instead of waiting for a second
//      click on the plan button. See handleMethodChange().
//   2. Ko-fi checkout now opens in a centered popup window instead of a
//      full new tab, so it reads as a modal over RIVANT rather than a
//      full navigation away from the site. See handleKofiPay().

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { createCryptoOrder, type CryptoOrder } from "@/lib/crypto-checkout";
import { CryptoCheckoutModal } from "./crypto-checkout-modal";

type Locale = "en" | "uk" | "de";
type PlanType = "starter" | "growth" | "premium";
type Method = "card" | "crypto";
type Phase = "picker" | "card-waiting" | "crypto-loading" | "crypto-checkout" | "success";

const PLAN_LABELS: Record<PlanType, { name: string; price: string }> = {
  starter: { name: "Starter", price: "$99" },
  growth: { name: "Growth", price: "$299" },
  premium: { name: "Scale", price: "$499" }, // display "Scale", DB id "premium"
};

const DICT: Record<
  Locale,
  {
    title: string;
    tabCard: string;
    tabCrypto: string;
    payWithKofi: string;
    generateInvoice: string;
    redirected: string;
    waitingTitle: string;
    waitingBody: string;
    reopenLink: string;
    successTitle: string;
    successBody: string;
    close: string;
  }
> = {
  en: {
    title: "Choose a plan",
    tabCard: "Card / PayPal",
    tabCrypto: "Crypto (USDC / Polygon)",
    payWithKofi: "Pay with Ko-fi",
    generateInvoice: "Generate crypto invoice",
    redirected: "We opened the Ko-fi checkout page in a new tab.",
    waitingTitle: "Waiting for payment confirmation",
    waitingBody: "This can take a couple of minutes. Please don't close this window.",
    reopenLink: "Tab didn't open? Open the link again",
    successTitle: "Subscription activated!",
    successBody: "Payment confirmed, your access is now open.",
    close: "Close",
  },
  uk: {
    title: "Оберіть тариф",
    tabCard: "Картка / PayPal",
    tabCrypto: "Крипта (USDC / Polygon)",
    payWithKofi: "Оплатити через Ko-fi",
    generateInvoice: "Згенерувати рахунок",
    redirected: "Ми відкрили сторінку оплати Ko-fi у новій вкладці.",
    waitingTitle: "Очікуємо підтвердження платежу",
    waitingBody: "Це може зайняти кілька хвилин. Не закривайте це вікно.",
    reopenLink: "Вкладка не відкрилась? Відкрити посилання ще раз",
    successTitle: "Підписку активовано!",
    successBody: "Оплату підтверджено, доступ відкрито.",
    close: "Закрити",
  },
  de: {
    title: "Plan wählen",
    tabCard: "Karte / PayPal",
    tabCrypto: "Krypto (USDC / Polygon)",
    payWithKofi: "Mit Ko-fi bezahlen",
    generateInvoice: "Krypto-Rechnung erstellen",
    redirected: "Wir haben die Ko-fi-Checkout-Seite in einem neuen Tab geöffnet.",
    waitingTitle: "Warte auf Zahlungsbestätigung",
    waitingBody: "Das kann ein paar Minuten dauern. Bitte schließen Sie dieses Fenster nicht.",
    reopenLink: "Tab nicht geöffnet? Link erneut öffnen",
    successTitle: "Abo aktiviert!",
    successBody: "Zahlung bestätigt, Ihr Zugang ist jetzt freigeschaltet.",
    close: "Schließen",
  },
};

// Реальные ссылки на Ko-fi Shop Items (тарифы). Если понадобится
// переопределить снаружи (напр. для теста) — проп kofiLinks всё ещё
// опционален и перекроет эти дефолты.
const DEFAULT_KOFI_LINKS: Record<PlanType, string> = {
  starter: "https://ko-fi.com/s/10eb6d89bf",
  growth: "https://ko-fi.com/s/9dcfdf1c5b",
  premium: "https://ko-fi.com/s/ed50f0bf6a",
};

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  locale: Locale;
  userId: string;
  kofiLinks?: Record<PlanType, string>;
  onActivated?: () => void;
  // When set, the modal skips the "choose a plan" list entirely and opens
  // straight on the method tabs (Card/PayPal vs Crypto) for THIS plan —
  // the person already picked it by clicking a specific pricing card.
  // Leave undefined to fall back to the old "pick any of 3 plans" picker.
  initialPlan?: PlanType;
}

export default function PaymentModal({
  isOpen,
  onClose,
  locale,
  userId,
  kofiLinks = DEFAULT_KOFI_LINKS,
  onActivated,
  initialPlan,
}: PaymentModalProps) {
  const t = DICT[locale];
  const [method, setMethod] = useState<Method>("card");
  const [phase, setPhase] = useState<Phase>("picker");
  const [cryptoOrder, setCryptoOrder] = useState<CryptoOrder | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const supabase = useRef(createClient()).current;

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const checkSubscriptionOnce = async () => {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("access_status")
      .eq("user_id", userId)
      .maybeSingle();

    if (!error && data?.access_status === "active") {
      setPhase("success");
      stopPolling();
    }
  };

  // Realtime watch + 15s poll fallback while waiting on the Ko-fi flow.
  useEffect(() => {
    if (phase !== "card-waiting") return;

    const channel = supabase
      .channel(`subscriptions-watch-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as { access_status?: string };
          if (row?.access_status === "active") {
            setPhase("success");
            onActivated?.();
            stopPolling();
          }
        },
      )
      .subscribe();

    pollRef.current = setInterval(checkSubscriptionOnce, 15000);

    return () => {
      supabase.removeChannel(channel);
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, userId]);

  useEffect(() => {
    if (!isOpen) {
      setPhase("picker");
      setMethod("card");
      setCryptoOrder(null);
      stopPolling();
    }
  }, [isOpen]);

  useEffect(() => {
    if (phase === "success") {
      const timer = setTimeout(onClose, 2500);
      return () => clearTimeout(timer);
    }
  }, [phase, onClose]);

  if (!isOpen) return null;

  // --- FIX 2: центрированный popup вместо полной новой вкладки ---------
  // Раньше: window.open(kofiLinks[plan], "_blank", "noopener,noreferrer")
  // открывал полноценную вкладку — пользователь визуально "уходил" с
  // сайта на ko-fi.com. Popup фиксированного размера по центру экрана
  // читается как модалка поверх RIVANT, а не как переход на чужой домен.
  const handleKofiPay = (plan: PlanType) => {
    const w = 480;
    const h = 720;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;

    const popup = window.open(
      kofiLinks[plan],
      "rivant_checkout",
      `width=${w},height=${h},left=${left},top=${top},resizable=no,scrollbars=yes`,
    );

    if (!popup) {
      // Popup заблокирован браузером — фоллбэк на старое поведение,
      // чтобы оплата не сломалась совсем.
      window.open(kofiLinks[plan], "_blank", "noopener,noreferrer");
    }

    setPhase("card-waiting");
  };

  const handleCryptoPick = async (plan: PlanType) => {
    setPhase("crypto-loading");
    try {
      const order = await createCryptoOrder({ planId: plan });
      setCryptoOrder(order);
      setPhase("crypto-checkout");
    } catch (err) {
      console.error("[PaymentModal] createCryptoOrder failed", err);
      setPhase("picker");
    }
  };

  // --- FIX 1: авто-генерация крипто-инвойса при смене таба --------------
  // Раньше клик по табу "Crypto" только подсвечивал его (setMethod), а
  // createCryptoOrder() вызывался лишь на отдельном клике по кнопке с
  // тарифом — то есть нужно было два клика подряд. Раз initialPlan уже
  // известен (пришли с конкретной карточки тарифа на pricing-странице),
  // тариф для инвойса понятен уже в момент клика по табу.
  const handleMethodChange = (m: Method) => {
    setMethod(m);
    if (m === "crypto" && initialPlan && !cryptoOrder && phase === "picker") {
      handleCryptoPick(initialPlan);
    }
  };

  // Crypto tab owns its own full UI (amount/address/copy, Realtime waiting,
  // expiry) once an order exists — just delegate to it.
  if (phase === "crypto-checkout" && cryptoOrder) {
    return (
      <CryptoCheckoutModal
        orderId={cryptoOrder.order_id}
        amountToSend={cryptoOrder.amount_to_send}
        token={cryptoOrder.token}
        chain={cryptoOrder.chain}
        receivingWallet={cryptoOrder.receiving_wallet}
        locale={locale}
        onClose={() => {
          setCryptoOrder(null);
          setPhase("picker");
        }}
        onSuccess={() => {
          setPhase("success");
          onActivated?.();
        }}
      />
    );
  }

  return (
    <div role="dialog" aria-modal="true" style={styles.overlay}>
      <div style={styles.card}>
        <button aria-label={t.close} onClick={onClose} style={styles.closeBtn}>
          ×
        </button>

        {phase === "picker" && (
          <>
            <h2 style={styles.title}>
              {initialPlan ? `${t.title} — ${PLAN_LABELS[initialPlan].name}` : t.title}
            </h2>

            <div style={styles.tabs}>
              <button
                onClick={() => handleMethodChange("card")}
                style={{ ...styles.tabBtn, ...(method === "card" ? styles.tabBtnActive : {}) }}
              >
                {t.tabCard}
              </button>
              <button
                onClick={() => handleMethodChange("crypto")}
                style={{ ...styles.tabBtn, ...(method === "crypto" ? styles.tabBtnActive : {}) }}
              >
                {t.tabCrypto}
              </button>
            </div>

            {initialPlan ? (
              // Plan already chosen on the pricing page — one button, no
              // re-selection. Only the payment method (tabs above) is
              // still a real choice here.
              <button
                onClick={() =>
                  method === "card" ? handleKofiPay(initialPlan) : handleCryptoPick(initialPlan)
                }
                style={styles.planBtn}
              >
                <span>{PLAN_LABELS[initialPlan].name}</span>
                <span style={{ fontFamily: "monospace" }}>{PLAN_LABELS[initialPlan].price}</span>
              </button>
            ) : (
              <div style={styles.planList}>
                {(Object.keys(PLAN_LABELS) as PlanType[]).map((planId) => {
                  const plan = PLAN_LABELS[planId];
                  return (
                    <button
                      key={planId}
                      onClick={() =>
                        method === "card" ? handleKofiPay(planId) : handleCryptoPick(planId)
                      }
                      style={styles.planBtn}
                    >
                      <span>{plan.name}</span>
                      <span style={{ fontFamily: "monospace" }}>{plan.price}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <p style={styles.subtle}>{method === "card" ? t.payWithKofi : t.generateInvoice}</p>
          </>
        )}

        {phase === "crypto-loading" && (
          <div style={styles.waitBlock}>
            <Spinner />
            <p style={styles.waitBody}>{t.generateInvoice}…</p>
          </div>
        )}

        {phase === "card-waiting" && (
          <div style={styles.waitBlock}>
            <Spinner />
            <p style={styles.waitTitle}>{t.waitingTitle}</p>
            <p style={styles.waitBody}>{t.waitingBody}</p>
          </div>
        )}

        {phase === "success" && (
          <div style={styles.waitBlock}>
            <CheckIcon />
            <p style={styles.successTitle}>{t.successTitle}</p>
            <p style={styles.waitBody}>{t.successBody}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div style={styles.spinnerRing}>
      <style>{`@keyframes rivant-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="22" stroke="#22c55e" strokeWidth="2.5" />
      <path
        d="M14 24.5 L20.5 31 L34 17"
        stroke="#22c55e"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(10, 10, 14, 0.6)",
    backdropFilter: "blur(4px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: 16,
  },
  card: {
    position: "relative",
    background: "#12121a",
    color: "#f4f4f6",
    borderRadius: 16,
    padding: "32px 28px",
    width: "100%",
    maxWidth: 420,
    boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
    border: "1px solid rgba(255,255,255,0.08)",
  },
  closeBtn: {
    position: "absolute",
    top: 12,
    right: 14,
    background: "transparent",
    border: "none",
    color: "#9a9aa5",
    fontSize: 24,
    cursor: "pointer",
    lineHeight: 1,
  },
  title: { fontSize: 18, fontWeight: 600, marginBottom: 16, paddingRight: 24 },
  tabs: {
    display: "flex",
    gap: 4,
    background: "rgba(255,255,255,0.05)",
    borderRadius: 10,
    padding: 4,
    marginBottom: 16,
  },
  tabBtn: {
    flex: 1,
    padding: "8px 10px",
    fontSize: 13,
    borderRadius: 8,
    border: "none",
    background: "transparent",
    color: "#a4a4b0",
    cursor: "pointer",
  },
  tabBtnActive: { background: "rgba(255,255,255,0.1)", color: "#f4f4f6" },
  planList: { display: "flex", flexDirection: "column", gap: 10 },
  planBtn: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 16px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "transparent",
    color: "#f4f4f6",
    cursor: "pointer",
  },
  subtle: { marginTop: 12, fontSize: 12, color: "#8b8b95" },
  waitBlock: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: 6,
    padding: "20px 0 4px",
  },
  waitTitle: { fontSize: 16, fontWeight: 600, marginTop: 14 },
  waitBody: { fontSize: 13.5, color: "#a4a4b0", lineHeight: 1.5, maxWidth: 300 },
  successTitle: { fontSize: 16, fontWeight: 600, marginTop: 10, color: "#22c55e" },
  spinnerRing: {
    width: 48,
    height: 48,
    borderRadius: "50%",
    border: "3px solid rgba(255,255,255,0.12)",
    borderTopColor: "#8b8bf5",
    animation: "rivant-spin 0.9s linear infinite",
  },
};
