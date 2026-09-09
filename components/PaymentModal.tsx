"use client";

// frontend/PaymentModal.tsx
//
// Plan picker with two tabs:
//   - "Card" -> creates a Creem checkout session server-side
//     (creem-checkout Edge Function, via lib/creem-checkout.ts), opens the
//     returned checkout_url in a centered popup window (falls back to a
//     new tab if the popup is blocked), then waits for creem-webhook to
//     flip public.subscriptions.access_status to 'active' (Realtime + 15s
//     poll fallback).
//   - "Crypto (USDC / Polygon)" -> calls createCryptoOrder() as soon as the
//     tab is selected (when initialPlan is known) and mounts the existing
//     CryptoCheckoutModal, which owns its own waiting/expiry UI via
//     useOrderStatus().
//
// Locales: en / uk / de only (no Russian — matches the site-wide rule).
// Plan ids match public.plans: "starter" | "growth" | "scale". (Used to be
// "premium" in the DB while the UI said "Scale" everywhere — renamed in
// migration 20260829000000_rename_premium_to_scale.sql because that split
// silently broke slot limits / Growth-feature access / admin plan
// validation for every Scale customer — they all checked for the literal
// string "scale", which never matched the real "premium" row.)
//
// --------------------------------------------------------------------------
// CHANGELOG (Ko-fi -> Creem replacement, 2026-09-09):
//
//   Ko-fi was a donation platform (Buy Me a Coffee-style checkout) — not a
//   fit for a B2B SaaS pricing page. Replaced with Creem, a Merchant of
//   Record built for SaaS: it handles VAT/tax compliance and gives a
//   proper subscription checkout instead of a "donate" button.
//
//   The static DEFAULT_KOFI_LINKS map (one fixed URL per plan) is gone —
//   Creem checkout sessions are created dynamically per click via
//   creem-checkout/index.ts, which resolves the price from public.plans
//   server-side and returns a one-time checkout_url. See
//   lib/creem-checkout.ts (same shape/contract as lib/crypto-checkout.ts).
//
//   The KofiRedirectConfirm ("check your cart, old items may still be in
//   it") warning step is REMOVED, not just relabeled: it existed only
//   because Ko-fi's cart was persistent and invisible to us, so an
//   abandoned earlier checkout could silently combine with a new one. A
//   Creem checkout session is single-product and one-shot — that failure
//   mode doesn't exist here, so handlePayWithCreem() goes straight from
//   click to "generate checkout session" to "open popup", no confirm
//   screen in between. Phase "kofi-confirm" is removed accordingly.
//
// --------------------------------------------------------------------------
// FIX (subscriptions_owner_read / userId — same class of bug already fixed
// in AddonCheckoutModal.tsx for businesses/addon_subscriptions):
//
//   `userId` passed into this component is the raw Supabase auth uid
//   (`data.session.user.id` in pricing-section.tsx). But subscriptions.user_id
//   is a foreign key into public.users.id, not auth.users.id — both
//   creem-webhook and app/api/webhooks/paddle/route.js write user_id from
//   `public.users.id`, resolved via auth_user_id. The old RLS policy
//   compared auth.uid() = user_id, so it never matched, and this component
//   was filtering .eq("user_id", userId) with the raw auth uid too — same
//   two different UUIDs, same mismatch.
//
//   Practical effect: the "Waiting for payment confirmation" screen spun
//   forever on the card path even after the webhook had already activated
//   the subscription server-side — both the Realtime watch and the 15s
//   poll fallback always got zero rows back.
//
//   Fixed the same way as AddonCheckoutModal.tsx: resolve public.users.id
//   from auth_user_id first (see resolvedUserId below), then use THAT id
//   for both the Realtime filter and the poll query. Paired with a
//   migration fixing subscriptions_owner_read to compare against
//   public.users.id instead of auth.uid() — needs both sides, RLS fix
//   alone still leaves the client filtering on the wrong id.
//
// CHANGELOG (pre-Creem, kept for context):
//   1. Crypto tab now fires createCryptoOrder() the moment the tab is
//      clicked (when initialPlan is set), instead of waiting for a second
//      click on the plan button. See handleMethodChange().
//   2. Card checkout opens in a centered popup window instead of a full
//      new tab, so it reads as a modal over RIVANT rather than a full
//      navigation away from the site. See openCheckoutPopup().
//   3. Closing (X) the crypto checkout screen now closes the whole modal
//      instead of falling back to the method picker. See the onClose
//      passed into <CryptoCheckoutModal> below.
//   4. Method-picker CTA redesigned: gradient button with a payment-method
//      icon + arrow instead of a plain bordered row, plus a "secure
//      checkout" badge instead of a small grey caption line. See
//      styles.ctaBtn / styles.secureBadge.

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { createCryptoOrder, type CryptoOrder } from "@/lib/crypto-checkout";
import { createCreemCheckout } from "@/lib/creem-checkout";
import { CryptoCheckoutModal } from "./crypto-checkout-modal";
import { CreditCard, Coins, ShieldCheck, ArrowRight } from "lucide-react";

type Locale = "en" | "uk" | "de";
type PlanType = "starter" | "growth" | "scale";
type Method = "card" | "crypto";
type Phase =
  | "picker"
  | "checkout-loading"
  | "card-waiting"
  | "crypto-loading"
  | "crypto-checkout"
  | "success";

const PLAN_LABELS: Record<PlanType, { name: string; price: string }> = {
  starter: { name: "Starter", price: "$99" },
  growth: { name: "Growth", price: "$299" },
  scale: { name: "Scale", price: "$499" },
};

const DICT: Record<
  Locale,
  {
    title: string;
    tabCard: string;
    tabCrypto: string;
    payWithCreem: string;
    generateInvoice: string;
    waitingTitle: string;
    waitingBody: string;
    successTitle: string;
    successBody: string;
    close: string;
  }
> = {
  en: {
    title: "Choose a plan",
    tabCard: "Card",
    tabCrypto: "Crypto (USDC / Polygon)",
    payWithCreem: "Secure checkout via Creem",
    generateInvoice: "Generate crypto invoice",
    waitingTitle: "Waiting for payment confirmation",
    waitingBody: "This can take a couple of minutes. Please don't close this window.",
    successTitle: "Subscription activated!",
    successBody: "Payment confirmed, your access is now open.",
    close: "Close",
  },
  uk: {
    title: "Оберіть тариф",
    tabCard: "Картка",
    tabCrypto: "Крипта (USDC / Polygon)",
    payWithCreem: "Безпечна оплата через Creem",
    generateInvoice: "Згенерувати рахунок",
    waitingTitle: "Очікуємо підтвердження платежу",
    waitingBody: "Це може зайняти кілька хвилин. Не закривайте це вікно.",
    successTitle: "Підписку активовано!",
    successBody: "Оплату підтверджено, доступ відкрито.",
    close: "Закрити",
  },
  de: {
    title: "Plan wählen",
    tabCard: "Karte",
    tabCrypto: "Krypto (USDC / Polygon)",
    payWithCreem: "Sichere Zahlung über Creem",
    generateInvoice: "Krypto-Rechnung erstellen",
    waitingTitle: "Warte auf Zahlungsbestätigung",
    waitingBody: "Das kann ein paar Minuten dauern. Bitte schließen Sie dieses Fenster nicht.",
    successTitle: "Abo aktiviert!",
    successBody: "Zahlung bestätigt, Ihr Zugang ist jetzt freigeschaltet.",
    close: "Schließen",
  },
};

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  locale: Locale;
  userId: string;
  onActivated?: () => void;
  // When set, the modal skips the "choose a plan" list entirely and opens
  // straight on the method tabs (Card vs Crypto) for THIS plan — the
  // person already picked it by clicking a specific pricing card. Leave
  // undefined to fall back to the old "pick any of 3 plans" picker.
  initialPlan?: PlanType;
}

export default function PaymentModal({
  isOpen,
  onClose,
  locale,
  userId,
  onActivated,
  initialPlan,
}: PaymentModalProps) {
  const t = DICT[locale];
  const [method, setMethod] = useState<Method>("card");
  const [phase, setPhase] = useState<Phase>("picker");
  const [cryptoOrder, setCryptoOrder] = useState<CryptoOrder | null>(null);
  // Resolved public.users.id — see FIX comment at the top of this file.
  // `userId` prop is the raw auth uid; subscriptions.user_id stores
  // public.users.id, so we resolve it once before filtering/watching.
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const supabase = useRef(createClient()).current;

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  // Resolve public.users.id from the auth uid as soon as we might need it
  // (entering card-waiting) — same lazy-resolve pattern as
  // AddonCheckoutModal.tsx's businessId effect.
  useEffect(() => {
    if (phase !== "card-waiting" || resolvedUserId) return;

    (async () => {
      const { data: profile, error: profileError } = await supabase
        .from("users")
        .select("id")
        .eq("auth_user_id", userId)
        .maybeSingle();

      if (profileError || !profile) {
        console.error("[PaymentModal] could not resolve public.users.id for auth uid", profileError, userId);
        return;
      }
      setResolvedUserId(profile.id as string);
    })();
  }, [phase, resolvedUserId, userId, supabase]);

  const checkSubscriptionOnce = async (uid: string) => {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("access_status")
      .eq("user_id", uid)
      .maybeSingle();

    if (!error && data?.access_status === "active") {
      setPhase("success");
      stopPolling();
    }
  };

  // Realtime watch + 15s poll fallback while waiting on the card flow.
  // Waits on resolvedUserId (public.users.id), not the raw userId prop —
  // see FIX comment at the top of this file.
  useEffect(() => {
    if (phase !== "card-waiting" || !resolvedUserId) return;

    const channel = supabase
      .channel(`subscriptions-watch-${resolvedUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${resolvedUserId}` },
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

    pollRef.current = setInterval(() => checkSubscriptionOnce(resolvedUserId), 15000);

    return () => {
      supabase.removeChannel(channel);
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, resolvedUserId]);

  useEffect(() => {
    if (!isOpen) {
      setPhase("picker");
      setMethod("card");
      setCryptoOrder(null);
      setResolvedUserId(null);
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

  // Центрированный popup вместо полной новой вкладки — читается как
  // модалка поверх RIVANT, а не как переход на чужой домен. Тот же
  // подход, что был у Ko-fi, только URL теперь одноразовый и приходит с
  // сервера (см. handlePayWithCreem ниже), а не берётся из статической
  // ссылки на тариф.
  const openCheckoutPopup = (checkoutUrl: string) => {
    const w = 480;
    const h = 720;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;

    const popup = window.open(
      checkoutUrl,
      "rivant_checkout",
      `width=${w},height=${h},left=${left},top=${top},resizable=no,scrollbars=yes`,
    );

    if (!popup) {
      // Popup заблокирован браузером — фоллбэк, чтобы оплата не сломалась.
      window.open(checkoutUrl, "_blank", "noopener,noreferrer");
    }

    setPhase("card-waiting");
  };

  // Creem checkout session одноразовая — генерируем её прямо по клику,
  // без промежуточного экрана подтверждения (Ko-fi's persistent-cart
  // warning здесь не нужен, см. CHANGELOG выше).
  const handlePayWithCreem = async (plan: PlanType) => {
    setPhase("checkout-loading");
    try {
      const { checkout_url } = await createCreemCheckout({ planId: plan });
      openCheckoutPopup(checkout_url);
    } catch (err) {
      console.error("[PaymentModal] createCreemCheckout failed", err);
      setPhase("picker");
    }
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
  // тариф для инвойса понятен уже в момент клика по табу. Card-таб этого
  // не делает намеренно — checkout session создаётся ТОЛЬКО по явному
  // клику на кнопку оплаты, не по факту переключения таба.
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
          // --- FIX 3: крестик на крипто-экране закрывает всю модалку -----
          // Раньше onClose тут только сбрасывал cryptoOrder/phase и
          // откатывал назад на экран выбора таба (card/crypto) — то есть
          // "закрыть" на крипто-шаге на деле означало "вернуться назад".
          // Теперь крестик всегда полностью закрывает окно оплаты, как и
          // ожидается от кнопки закрытия — если пользователь захочет
          // сменить способ оплаты, он откроет модалку заново с pricing-карточки.
          setCryptoOrder(null);
          setPhase("picker");
          onClose();
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
                  method === "card" ? handlePayWithCreem(initialPlan) : handleCryptoPick(initialPlan)
                }
                style={styles.ctaBtn}
              >
                {method === "card" ? <CreditCard size={20} /> : <Coins size={20} />}
                <span style={styles.ctaBtnText}>
                  {PLAN_LABELS[initialPlan].name} · {PLAN_LABELS[initialPlan].price}
                </span>
                <ArrowRight size={18} style={{ marginLeft: "auto", opacity: 0.7 }} />
              </button>
            ) : (
              <div style={styles.planList}>
                {(Object.keys(PLAN_LABELS) as PlanType[]).map((planId) => {
                  const plan = PLAN_LABELS[planId];
                  return (
                    <button
                      key={planId}
                      onClick={() =>
                        method === "card" ? handlePayWithCreem(planId) : handleCryptoPick(planId)
                      }
                      style={styles.ctaBtn}
                    >
                      {method === "card" ? <CreditCard size={20} /> : <Coins size={20} />}
                      <span style={styles.ctaBtnText}>
                        {plan.name} · {plan.price}
                      </span>
                      <ArrowRight size={18} style={{ marginLeft: "auto", opacity: 0.7 }} />
                    </button>
                  );
                })}
              </div>
            )}

            <div style={styles.secureBadge}>
              <ShieldCheck size={14} style={{ flexShrink: 0 }} />
              <span>{method === "card" ? t.payWithCreem : t.generateInvoice}</span>
            </div>
          </>
        )}

        {phase === "checkout-loading" && (
          <div style={styles.waitBlock}>
            <Spinner />
            <p style={styles.waitBody}>{t.payWithCreem}…</p>
          </div>
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
  // --- FIX 4: живой CTA вместо плоской серой строки-заглушки ------------
  // Раньше кнопка тарифа была нейтральной (transparent + тонкая рамка) и
  // ничем не отличалась от второстепенного элемента интерфейса — из-за
  // этого весь экран выбора способа оплаты выглядел как черновик, а не
  // как "нажми, чтобы купить". Теперь это акцентная кнопка с брендовым
  // градиентом, иконкой способа оплаты и стрелкой действия.
  ctaBtn: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "14px 18px",
    borderRadius: 12,
    border: "none",
    background: "linear-gradient(135deg, #4f7cff 0%, #6f5bff 100%)",
    color: "#ffffff",
    cursor: "pointer",
    boxShadow: "0 8px 20px -6px rgba(79, 124, 255, 0.55)",
    transition: "transform 0.15s ease, box-shadow 0.15s ease",
  },
  ctaBtnText: { fontSize: 15, fontWeight: 600, letterSpacing: 0.2 },
  // Плашка "безопасно/обрабатывается через X" вместо мелкого серого текста —
  // читается как знак доверия (замочек в кружке), а не как незаметная сноска.
  secureBadge: {
    marginTop: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "8px 12px",
    borderRadius: 999,
    background: "rgba(34, 197, 94, 0.08)",
    border: "1px solid rgba(34, 197, 94, 0.25)",
    color: "#7fd8a0",
    fontSize: 12,
    fontWeight: 500,
  },
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