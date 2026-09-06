"use client";

// components/dashboard/onboarding-checklist.tsx
//
// Чек-лист "завершення налаштування" — окремий від OnboardingTour
// (той — одноразовий spotlight-тур по інтерфейсу, цей — довготривалий
// прогрес-віджет, який лишається видимим, поки не виконані реальні дії:
// профіль, перше джерело доходу, Telegram). Обидва можуть співіснувати —
// тур показує ДЕ що знаходиться, чек-лист нагадує ЩО ще не зроблено.
//
// Один компонент, один fetch до /api/onboarding-status — рендериться
// по-різному залежно від розміру екрана через Tailwind-брейкпоінти
// (hidden/sm:flex), а не окремими компонентами з дубльованою логікою:
//   - Desktop (sm+): горизонтальний банер над метриками, кроки видно одразу.
//   - Mobile (<sm): компактне кільце-прогрес (не займає висоту постійно) —
//     тап відкриває bottom sheet з тими самими кроками.
//
// Ховається назавжди (localStorage, per-business ключ), тільки коли ВСІ
// кроки виконано — сам компонент вирішує, показувати банер "Все готово"
// один раз чи одразу зникнути; ручне закриття (X) до завершення лишає
// маленький бейдж-нагадування, а не прибирає прогрес зовсім (див. ідею
// "відчуття незавершеності" — ховати насовсім тут суперечило б меті).
import { useEffect, useState } from "react";
import { Check, ChevronRight, Send, Sliders, UserCircle2, X } from "lucide-react";

type Language = "EN" | "UA" | "DE";
type ViewType = "overview" | "risks" | "forecast" | "integrations" | "settings" | "faq";

interface StepStatus {
  id: "profile" | "integration" | "telegram";
  done: boolean;
}

interface OnboardingStatusResponse {
  steps: StepStatus[];
  completed: number;
  total: number;
}

const STORAGE_KEY_PREFIX = "rivant_onboarding_dismissed_";

const STEP_META: Record<
  StepStatus["id"],
  { icon: typeof UserCircle2; view: ViewType; label: Record<Language, string> }
> = {
  profile: {
    icon: UserCircle2,
    view: "settings",
    label: {
      UA: "Заповнити профіль (часовий пояс)",
      DE: "Profil ausfüllen (Zeitzone)",
      EN: "Complete your profile (timezone)",
    },
  },
  integration: {
    icon: Sliders,
    view: "integrations",
    label: {
      UA: "Підключити перше джерело доходу",
      DE: "Erste Umsatzquelle verbinden",
      EN: "Connect your first revenue source",
    },
  },
  telegram: {
    icon: Send,
    view: "settings",
    label: {
      UA: "Підключити Telegram-сповіщення",
      DE: "Telegram-Benachrichtigungen verbinden",
      EN: "Connect Telegram notifications",
    },
  },
};

const TITLE: Record<Language, string> = {
  UA: "Завершіть налаштування",
  DE: "Einrichtung abschließen",
  EN: "Finish setting up",
};

const ALL_DONE_TITLE: Record<Language, string> = {
  UA: "Все готово ✓",
  DE: "Alles erledigt ✓",
  EN: "All set ✓",
};

const PROGRESS_LABEL: Record<Language, (done: number, total: number) => string> = {
  UA: (done, total) => `Виконано ${done} з ${total}`,
  DE: (done, total) => `${done} von ${total} erledigt`,
  EN: (done, total) => `${done} of ${total} done`,
};

export function OnboardingChecklist({
  language,
  businessId,
  onNavigate,
}: {
  language: Language;
  // Використовується лише як ключ localStorage, щоб ручне закриття не
  // ховало чек-лист іншого бізнесу на тому самому браузері (team-доступ).
  businessId?: string | null;
  onNavigate: (view: ViewType) => void;
}) {
  const [status, setStatus] = useState<OnboardingStatusResponse | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  const storageKey = `${STORAGE_KEY_PREFIX}${businessId || "default"}`;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/onboarding-status", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch((e) => console.error("Failed to load onboarding status", e));
    try {
      setDismissed(localStorage.getItem(storageKey) === "1");
    } catch {
      // localStorage недоступний (приватний режим тощо) — просто не
      // запам'ятовуємо закриття цієї сесії, не критично.
    }
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  if (!status) return null;

  const allDone = status.completed === status.total;
  // Завершений чек-лист і так ховається сам (не рахуємо dismissed) —
  // dismissed стосується тільки незавершеного стану, який показувати
  // до кінця не обов'язково нав'язливо.
  if (allDone) return null;
  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(storageKey, "1");
    } catch {
      // ignore
    }
  };

  const goToStep = (view: ViewType) => {
    onNavigate(view);
    setMobileSheetOpen(false);
  };

  const percent = Math.round((status.completed / status.total) * 100);
  // r=15.9155 — стандартний радіус для SVG-кільця, довжина кола якого
  // рівно 100, тому strokeDasharray/strokeDashoffset можна рахувати прямо
  // у відсотках без додаткової математики.
  const RADIUS = 15.9155;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  const StepsList = ({ compact }: { compact?: boolean }) => (
    <div className={compact ? "space-y-2" : "flex flex-col sm:flex-row gap-2 sm:gap-3"}>
      {status.steps.map((step) => {
        const meta = STEP_META[step.id];
        const Icon = meta.icon;
        return (
          <button
            key={step.id}
            onClick={() => goToStep(meta.view)}
            disabled={step.done}
            className={`flex items-center gap-2.5 text-left rounded-lg border px-3 py-2 transition-colors ${
              step.done
                ? "border-green-500/20 bg-green-500/5 cursor-default"
                : "border-gray-700 bg-gray-900/60 hover:bg-gray-800 hover:border-gray-600"
            } ${compact ? "w-full" : "sm:flex-1"}`}
          >
            <span
              className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center ${
                step.done ? "bg-green-500/20 text-green-400" : "bg-blue-500/10 text-blue-400"
              }`}
            >
              {step.done ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
            </span>
            <span className={`text-sm flex-1 ${step.done ? "text-gray-500 line-through" : "text-gray-200"}`}>
              {meta.label[language]}
            </span>
            {!step.done && <ChevronRight className="w-4 h-4 text-gray-600 shrink-0" />}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      {/* Desktop / tablet — горизонтальний банер */}
      <div className="hidden sm:block bg-gradient-to-r from-blue-500/10 via-gray-900/40 to-transparent rounded-xl border border-blue-500/20 p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-white font-semibold text-sm">{TITLE[language]}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{PROGRESS_LABEL[language](status.completed, status.total)}</p>
          </div>
          <button
            onClick={handleDismiss}
            aria-label="Dismiss"
            className="text-gray-600 hover:text-gray-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <StepsList />
      </div>

      {/* Mobile — компактне кільце-прогрес у потоці контенту, без банера */}
      <div className="sm:hidden">
        <button
          onClick={() => setMobileSheetOpen(true)}
          className="w-full flex items-center gap-3 bg-gray-900/60 border border-gray-800 rounded-xl px-3 py-2.5"
        >
          <svg viewBox="0 0 36 36" className="w-8 h-8 shrink-0 -rotate-90">
            <circle cx="18" cy="18" r={RADIUS} fill="none" stroke="currentColor" strokeWidth="3" className="text-gray-800" />
            <circle
              cx="18"
              cy="18"
              r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              className="text-blue-400"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE}
            />
          </svg>
          <div className="flex-1 text-left">
            <div className="text-sm font-medium text-white">{TITLE[language]}</div>
            <div className="text-xs text-gray-500">{PROGRESS_LABEL[language](status.completed, status.total)}</div>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-600 shrink-0" />
        </button>
      </div>

      {mobileSheetOpen && (
        <div className="sm:hidden fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileSheetOpen(false)} />
          <div className="relative w-full bg-gray-950 border-t border-gray-800 rounded-t-2xl p-4 pb-6 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-white font-semibold text-sm">{TITLE[language]}</h3>
              <button
                onClick={() => setMobileSheetOpen(false)}
                aria-label="Close"
                className="text-gray-600 hover:text-gray-400 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <StepsList compact />
            <button
              onClick={handleDismiss}
              className="text-xs text-gray-600 hover:text-gray-400 underline underline-offset-2 pt-1"
            >
              {language === "UA" ? "Приховати поки що" : language === "DE" ? "Vorerst ausblenden" : "Hide for now"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
