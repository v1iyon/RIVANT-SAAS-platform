"use client";

// frontend/PaymentModal.tsx
//
// Модалка оплаты тарифа: открывает Ko-fi Tier в новой вкладке,
// показывает лоадер ожидания вебхука и слушает public.subscriptions
// через Supabase Realtime — как только webhook активирует подписку,
// окно закрывается само.
//
// Использование:
//   <PaymentModal
//     isOpen={isOpen}
//     onClose={() => setIsOpen(false)}
//     locale="ru"                 // 'ru' | 'uk' | 'en'
//     planType="growth"           // 'starter' | 'growth' | 'premium' (premium = "Scale" tier)
//     userId={user.id}
//     kofiLinks={{
//       starter: "https://ko-fi.com/yourpage/tiers/starter-id",
//       growth: "https://ko-fi.com/yourpage/tiers/growth-id",
//       premium: "https://ko-fi.com/yourpage/tiers/scale-id",
//     }}
//     onActivated={() => router.push('/dashboard')}
//   />

import { useEffect, useRef, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------
// i18n словарь
// ---------------------------------------------------------------
type Locale = "ru" | "uk" | "en";
type PlanType = "starter" | "growth" | "premium"; // premium = id из public.plans для тира "Scale"

const PLAN_LABELS: Record<PlanType, { ru: string; uk: string; en: string; price: string }> = {
  starter: { ru: "Starter", uk: "Starter", en: "Starter", price: "$99" },
  growth: { ru: "Growth", uk: "Growth", en: "Growth", price: "$299" },
  premium: { ru: "Scale", uk: "Scale", en: "Scale", price: "$499" }, // display "Scale", DB id "premium"
};

const DICT: Record<Locale, {
  title: (plan: string, price: string) => string;
  redirected: string;
  waitingTitle: string;
  waitingBody: string;
  reopenLink: string;
  successTitle: string;
  successBody: string;
  errorTitle: string;
  errorBody: string;
  close: string;
}> = {
  ru: {
    title: (plan, price) => `Оплата тарифа ${plan} — ${price}`,
    redirected: "Мы открыли страницу оплаты Ko-fi в новой вкладке.",
    waitingTitle: "Ожидаем подтверждения платежа",
    waitingBody:
      "Ожидаем автоматического подтверждения платежа от процессора… Пожалуйста, не закрывайте эту страницу.",
    reopenLink: "Не открылась вкладка? Открыть ссылку заново",
    successTitle: "Подписка активирована!",
    successBody: "Оплата подтверждена, доступ открыт.",
    errorTitle: "Что-то пошло не так",
    errorBody: "Проверьте соединение или повторите попытку позже.",
    close: "Закрыть",
  },
  uk: {
    title: (plan, price) => `Оплата тарифу ${plan} — ${price}`,
    redirected: "Ми відкрили сторінку оплати Ko-fi у новій вкладці.",
    waitingTitle: "Очікуємо підтвердження платежу",
    waitingBody:
      "Очікуємо автоматичного підтвердження платежу від процесора… Будь ласка, не закривайте цю сторінку.",
    reopenLink: "Вкладка не відкрилась? Відкрити посилання ще раз",
    successTitle: "Підписку активовано!",
    successBody: "Оплату підтверджено, доступ відкрито.",
    errorTitle: "Щось пішло не так",
    errorBody: "Перевірте з'єднання або спробуйте пізніше.",
    close: "Закрити",
  },
  en: {
    title: (plan, price) => `${plan} plan checkout — ${price}`,
    redirected: "We opened the Ko-fi checkout page in a new tab.",
    waitingTitle: "Waiting for payment confirmation",
    waitingBody:
      "Waiting for automatic payment confirmation from the processor… Please don't close this page.",
    reopenLink: "Tab didn't open? Open the link again",
    successTitle: "Subscription activated!",
    successBody: "Payment confirmed, your access is now open.",
    errorTitle: "Something went wrong",
    errorBody: "Check your connection or try again later.",
    close: "Close",
  },
};

// ---------------------------------------------------------------
// Пропсы
// ---------------------------------------------------------------
interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  locale: Locale;
  planType: PlanType;
  userId: string;
  kofiLinks: Record<PlanType, string>;
  onActivated?: () => void;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

type Phase = "redirecting" | "waiting" | "success" | "error";

export default function PaymentModal({
  isOpen,
  onClose,
  locale,
  planType,
  userId,
  kofiLinks,
  onActivated,
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
}: PaymentModalProps) {
  const [phase, setPhase] = useState<Phase>("redirecting");
  const supabaseRef = useRef<SupabaseClient | null>(null);
  const t = DICT[locale];
  const plan = PLAN_LABELS[planType];

  // Ленивая инициализация supabase-клиента (один раз)
  if (!supabaseRef.current && supabaseUrl && supabaseAnonKey) {
    supabaseRef.current = createClient(supabaseUrl, supabaseAnonKey);
  }

  const openKofiLink = () => {
    const link = kofiLinks[planType];
    window.open(link, "_blank", "noopener,noreferrer");
    setPhase("waiting");
  };

  // При открытии модалки — сразу редиректим на Ko-fi
  useEffect(() => {
    if (!isOpen) return;
    setPhase("redirecting");
    const timer = setTimeout(openKofiLink, 400); // короткая пауза, чтобы модалка успела отрисоваться
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, planType]);

  // Realtime-подписка на public.subscriptions: как только webhook
  // проставит access_status='active' и plan_type совпадёт — закрываем модалку.
  useEffect(() => {
    if (!isOpen || phase !== "waiting") return;
    const supabase = supabaseRef.current;
    if (!supabase) {
      console.error("Supabase client is not configured (missing URL/anon key)");
      setPhase("error");
      return;
    }

    const channel = supabase
      .channel(`subscriptions-watch-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "subscriptions",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as { access_status: string; plan: string };
          if (row.access_status === "active") {
            setPhase("success");
            onActivated?.();
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "subscriptions",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as { access_status: string };
          if (row.access_status === "active") {
            setPhase("success");
            onActivated?.();
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isOpen, phase, userId, onActivated]);

  // Автозакрытие через пару секунд после успеха
  useEffect(() => {
    if (phase !== "success") return;
    const timer = setTimeout(onClose, 2500);
    return () => clearTimeout(timer);
  }, [phase, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-modal-title"
      style={styles.overlay}
    >
      <div style={styles.card}>
        <button aria-label={t.close} onClick={onClose} style={styles.closeBtn}>
          ×
        </button>

        <h2 id="payment-modal-title" style={styles.title}>
          {t.title(plan[locale], plan.price)}
        </h2>

        {phase === "redirecting" && <p style={styles.subtle}>{t.redirected}</p>}

        {phase === "waiting" && (
          <div style={styles.waitBlock}>
            <Spinner />
            <p style={styles.waitTitle}>{t.waitingTitle}</p>
            <p style={styles.waitBody}>{t.waitingBody}</p>
            <button onClick={openKofiLink} style={styles.linkBtn}>
              {t.reopenLink}
            </button>
          </div>
        )}

        {phase === "success" && (
          <div style={styles.waitBlock}>
            <CheckIcon />
            <p style={styles.successTitle}>{t.successTitle}</p>
            <p style={styles.waitBody}>{t.successBody}</p>
          </div>
        )}

        {phase === "error" && (
          <div style={styles.waitBlock}>
            <p style={styles.successTitle}>{t.errorTitle}</p>
            <p style={styles.waitBody}>{t.errorBody}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Мелкие визуальные детали: спиннер и иконка успеха, без внешних либ
// ---------------------------------------------------------------
function Spinner() {
  return (
    <div style={styles.spinnerWrap}>
      <div style={styles.spinnerRing} />
      <style>{`
        @keyframes rivant-spin { to { transform: rotate(360deg); } }
        @keyframes rivant-pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
      `}</style>
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

// ---------------------------------------------------------------
// Инлайн-стили (можно заменить на Tailwind/CSS-модуль по вкусу проекта)
// ---------------------------------------------------------------
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
  title: {
    fontSize: 18,
    fontWeight: 600,
    marginBottom: 20,
    paddingRight: 24,
  },
  subtle: {
    color: "#b3b3bd",
    fontSize: 14,
  },
  waitBlock: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: 6,
    padding: "12px 0 4px",
  },
  waitTitle: {
    fontSize: 16,
    fontWeight: 600,
    marginTop: 14,
  },
  waitBody: {
    fontSize: 13.5,
    color: "#a4a4b0",
    lineHeight: 1.5,
    maxWidth: 300,
  },
  successTitle: {
    fontSize: 16,
    fontWeight: 600,
    marginTop: 10,
    color: "#22c55e",
  },
  linkBtn: {
    marginTop: 14,
    background: "transparent",
    border: "none",
    color: "#8b8bf5",
    fontSize: 13,
    textDecoration: "underline",
    cursor: "pointer",
  },
  spinnerWrap: {
    width: 48,
    height: 48,
  },
  spinnerRing: {
    width: 48,
    height: 48,
    borderRadius: "50%",
    border: "3px solid rgba(255,255,255,0.12)",
    borderTopColor: "#8b8bf5",
    animation: "rivant-spin 0.9s linear infinite",
  },
};