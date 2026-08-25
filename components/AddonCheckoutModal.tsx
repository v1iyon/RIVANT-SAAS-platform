"use client";

// components/AddonCheckoutModal.tsx
//
// Payment-method picker for a single add-on (whatif_analysis /
// monthly_digest / team_alerts), replacing the old "click -> straight to
// Ko-fi" flow in PricingSection.tsx's handleOrderService.
//
// Mirrors PaymentModal.tsx's structure closely (tabs -> CTA -> waiting ->
// success), just scoped to one add-on instead of a 3-plan picker:
//   - "Card / PayPal" -> KofiRedirectConfirm warning, then opens Ko-fi in a
//     centered popup (same pattern as PaymentModal.openKofiPopup). No
//     `orders` row exists for this path, so there's nothing to poll for a
//     one-time service (service_orders creation is fire-and-forget from
//     the UI's perspective — kofi-webhook creates it once the payment
//     lands, per plan.md: "просто подтверждение, без ожидания real-time").
//     For a recurring add-on we CAN watch for activation, via
//     useAddonSubscriptionStatus on public.addon_subscriptions.
//   - "Crypto (USDC / Polygon)" -> createCryptoOrder({ addonKind, addonSlug })
//     and mounts the existing (already generic) CryptoCheckoutModal, which
//     owns its own waiting/expiry UI via useOrderStatus(). Because
//     polygon-webhook processes the addon synchronously within the same
//     request that flips `orders.status` to 'paid', CryptoCheckoutModal's
//     onSuccess is already a reliable signal here — no extra polling
//     needed on the crypto path, for either addon kind.
//
// Locales: en / uk / de only, same rule as the rest of the payment flow.
//
// --------------------------------------------------------------------------
// FIX (business_id resolution — was querying businesses with the wrong id):
//
//   `userId` passed into this component is the raw Supabase auth uid
//   (`data.session.user.id` in PricingSection.tsx). A live schema check
//   confirmed `businesses.user_id` is a foreign key into `public.users.id`
//   — NOT into `auth.users.id` — and those are two different UUIDs
//   (public.users has its own `auth_user_id` column that maps one to the
//   other; supabase/functions/create-order/index.ts already does this
//   exact lookup before touching `orders`).
//
//   The old effect below queried `businesses.user_id = eq(userId)` using
//   the raw auth uid directly, which almost certainly matched zero rows.
//   Practical effect: for Ko-fi-paid recurring add-ons, businessId never
//   resolved, useAddonSubscriptionStatus never got a real id to watch,
//   and the "waiting for confirmation" screen would spin forever even
//   after kofi-webhook successfully activated the subscription server-side.
//
//   Fixed by resolving `public.users.id` from the auth uid first (via
//   `auth_user_id`), then querying `businesses` with THAT id — same two
//   hops create-order/index.ts already does. Only this one effect
//   changed; nothing else in the component depends on the shape of userId.

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { createCryptoOrder, type CryptoOrder } from "@/lib/crypto-checkout";
import { CryptoCheckoutModal } from "./crypto-checkout-modal";
import { KofiRedirectConfirm } from "./kofi-redirect-confirm";
import { useAddonSubscriptionStatus } from "@/hooks/use-addon-subscription-status";
import { CreditCard, Coins, ShieldCheck, ArrowRight } from "lucide-react";

type Locale = "en" | "uk" | "de";
type Method = "card" | "crypto";
type AddonKind = "order" | "subscription";
type Phase =
  | "method"
  | "kofi-confirm"
  | "card-waiting"
  | "crypto-loading"
  | "crypto-checkout"
  | "success";

export interface AddonInfo {
  slug: string; // e.g. "whatif_analysis" — must match ADDON_CATALOG in create-order/index.ts
  kind: AddonKind; // "order" (one-time) | "subscription" (recurring)
  name: string;
  priceLabel: string; // e.g. "$199" — display only, real price is resolved server-side
  kofiLink: string;
}

const DICT: Record<
  Locale,
  {
    tabCard: string;
    tabCrypto: string;
    payWithKofi: string;
    generateInvoice: string;
    waitingTitleOrder: string;
    waitingBodyOrder: string;
    waitingTitleSub: string;
    waitingBodySub: string;
    successTitle: string;
    successBodyOrder: string;
    successBodySub: string;
    close: string;
  }
> = {
  en: {
    tabCard: "Card / PayPal",
    tabCrypto: "Crypto (USDC / Polygon)",
    payWithKofi: "Pay with Ko-fi",
    generateInvoice: "Generate crypto invoice",
    waitingTitleOrder: "Payment submitted",
    waitingBodyOrder: "Your order has been sent — the report will be delivered within a few days.",
    waitingTitleSub: "Waiting for payment confirmation",
    waitingBodySub: "This can take a couple of minutes. Please don't close this window.",
    successTitle: "Done!",
    successBodyOrder: "Payment confirmed, your order is now being processed.",
    successBodySub: "Payment confirmed, the add-on is now active.",
    close: "Close",
  },
  uk: {
    tabCard: "Картка / PayPal",
    tabCrypto: "Крипта (USDC / Polygon)",
    payWithKofi: "Оплатити через Ko-fi",
    generateInvoice: "Згенерувати рахунок",
    waitingTitleOrder: "Оплату надіслано",
    waitingBodyOrder: "Замовлення передано — звіт надійде протягом кількох днів.",
    waitingTitleSub: "Очікуємо підтвердження платежу",
    waitingBodySub: "Це може зайняти кілька хвилин. Не закривайте це вікно.",
    successTitle: "Готово!",
    successBodyOrder: "Оплату підтверджено, замовлення в обробці.",
    successBodySub: "Оплату підтверджено, додаток активовано.",
    close: "Закрити",
  },
  de: {
    tabCard: "Karte / PayPal",
    tabCrypto: "Krypto (USDC / Polygon)",
    payWithKofi: "Mit Ko-fi bezahlen",
    generateInvoice: "Krypto-Rechnung erstellen",
    waitingTitleOrder: "Zahlung übermittelt",
    waitingBodyOrder: "Ihre Bestellung wurde gesendet — der Bericht wird innerhalb weniger Tage geliefert.",
    waitingTitleSub: "Warte auf Zahlungsbestätigung",
    waitingBodySub: "Das kann ein paar Minuten dauern. Bitte schließen Sie dieses Fenster nicht.",
    successTitle: "Fertig!",
    successBodyOrder: "Zahlung bestätigt, Ihre Bestellung wird bearbeitet.",
    successBodySub: "Zahlung bestätigt, das Add-on ist jetzt aktiv.",
    close: "Schließen",
  },
};

interface AddonCheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  locale: Locale;
  userId: string; // raw Supabase auth uid — resolved to public.users.id internally, see FIX above
  addon: AddonInfo;
}

export function AddonCheckoutModal({ isOpen, onClose, locale, userId, addon }: AddonCheckoutModalProps) {
  const t = DICT[locale];
  const [method, setMethod] = useState<Method>("card");
  const [phase, setPhase] = useState<Phase>("method");
  const [cryptoOrder, setCryptoOrder] = useState<CryptoOrder | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const supabase = useRef(createClient()).current;

  // Only meaningful once we're on the card-waiting phase for a
  // subscription-kind addon — the hook itself no-ops safely on a null
  // businessId, so it's fine to always call it (rules of hooks).
  const { isActive: subActive } = useAddonSubscriptionStatus(
    phase === "card-waiting" && addon.kind === "subscription" ? businessId : null,
    addon.slug,
  );

  useEffect(() => {
    if (subActive) {
      setPhase("success");
    }
  }, [subActive]);

  useEffect(() => {
    if (!isOpen) {
      setPhase("method");
      setMethod("card");
      setCryptoOrder(null);
      setBusinessId(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (phase === "success") {
      const timer = setTimeout(onClose, 2500);
      return () => clearTimeout(timer);
    }
  }, [phase, onClose]);

  // Resolve business_id lazily, only when we actually need it (entering
  // card-waiting for a subscription addon) — plan/order-kind addons never
  // need it client-side.
  //
  // FIX: `userId` is the raw auth uid, but `businesses.user_id` FKs into
  // `public.users.id`, not `auth.users.id` (confirmed via schema check —
  // same indirection supabase/functions/create-order/index.ts already
  // uses). So we resolve public.users.id via auth_user_id FIRST, then
  // query businesses with that resolved id, instead of querying
  // businesses directly with the auth uid (which was matching zero rows).
  useEffect(() => {
    if (phase !== "card-waiting" || addon.kind !== "subscription" || businessId) return;

    (async () => {
      const { data: profile, error: profileError } = await supabase
        .from("users")
        .select("id")
        .eq("auth_user_id", userId)
        .maybeSingle();

      if (profileError || !profile) {
        console.error("[AddonCheckoutModal] could not resolve public.users.id for auth uid", profileError, userId);
        return;
      }

      const { data, error } = await supabase.from("businesses").select("id").eq("user_id", profile.id);
      if (error || !data || data.length !== 1) {
        console.error("[AddonCheckoutModal] could not resolve a single business_id", error, data);
        return;
      }
      setBusinessId(data[0].id as string);
    })();
  }, [phase, addon.kind, businessId, userId, supabase]);

  if (!isOpen) return null;

  // Same centered-popup pattern as PaymentModal.openKofiPopup.
  const openKofiPopup = () => {
    const w = 480;
    const h = 720;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;

    const popup = window.open(
      addon.kofiLink,
      "rivant_checkout",
      `width=${w},height=${h},left=${left},top=${top},resizable=no,scrollbars=yes`,
    );

    if (!popup) {
      window.open(addon.kofiLink, "_blank", "noopener,noreferrer");
    }

    setPhase("card-waiting");
  };

  const handleCryptoPick = async () => {
    setPhase("crypto-loading");
    try {
      const order = await createCryptoOrder({ addonKind: addon.kind, addonSlug: addon.slug });
      setCryptoOrder(order);
      setPhase("crypto-checkout");
    } catch (err) {
      console.error("[AddonCheckoutModal] createCryptoOrder failed", err);
      setPhase("method");
    }
  };

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
          setPhase("method");
          onClose();
        }}
        onSuccess={() => setPhase("success")}
      />
    );
  }

  if (phase === "kofi-confirm") {
    return (
      <KofiRedirectConfirm
        itemName={addon.name}
        priceLabel={addon.priceLabel}
        locale={locale}
        onCancel={() => setPhase("method")}
        onConfirm={openKofiPopup}
      />
    );
  }

  return (
    <div role="dialog" aria-modal="true" style={styles.overlay}>
      <div style={styles.card}>
        <button aria-label={t.close} onClick={onClose} style={styles.closeBtn}>
          ×
        </button>

        {phase === "method" && (
          <>
            <h2 style={styles.title}>
              {addon.name} · {addon.priceLabel}
            </h2>

            <div style={styles.tabs}>
              <button
                onClick={() => setMethod("card")}
                style={{ ...styles.tabBtn, ...(method === "card" ? styles.tabBtnActive : {}) }}
              >
                {t.tabCard}
              </button>
              <button
                onClick={() => setMethod("crypto")}
                style={{ ...styles.tabBtn, ...(method === "crypto" ? styles.tabBtnActive : {}) }}
              >
                {t.tabCrypto}
              </button>
            </div>

            <button
              onClick={() => (method === "card" ? setPhase("kofi-confirm") : handleCryptoPick())}
              style={styles.ctaBtn}
            >
              {method === "card" ? <CreditCard size={20} /> : <Coins size={20} />}
              <span style={styles.ctaBtnText}>
                {addon.name} · {addon.priceLabel}
              </span>
              <ArrowRight size={18} style={{ marginLeft: "auto", opacity: 0.7 }} />
            </button>

            <div style={styles.secureBadge}>
              <ShieldCheck size={14} style={{ flexShrink: 0 }} />
              <span>{method === "card" ? t.payWithKofi : t.generateInvoice}</span>
            </div>
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
            <p style={styles.waitTitle}>{addon.kind === "order" ? t.waitingTitleOrder : t.waitingTitleSub}</p>
            <p style={styles.waitBody}>{addon.kind === "order" ? t.waitingBodyOrder : t.waitingBodySub}</p>
          </div>
        )}

        {phase === "success" && (
          <div style={styles.waitBlock}>
            <CheckIcon />
            <p style={styles.successTitle}>{t.successTitle}</p>
            <p style={styles.waitBody}>{addon.kind === "order" ? t.successBodyOrder : t.successBodySub}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div style={styles.spinnerRing}>
      <style>{`@keyframes rivant-addon-spin { to { transform: rotate(360deg); } }`}</style>
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

// Same visual language as PaymentModal.tsx's styles object, kept local so
// this component doesn't depend on PaymentModal's internals.
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
    animation: "rivant-addon-spin 0.9s linear infinite",
  },
};