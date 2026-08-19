"use client";

import { useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

type Language = "EN" | "UA" | "DE";
type ViewType = "overview" | "risks" | "forecast" | "integrations" | "settings";

interface Step {
  view: ViewType | null;
  title: Record<Language, string>;
  desc: Record<Language, string>;
}

// Поверхностный тур: по одному короткому шагу на каждую вкладку сайдбара
// (overview / risks / forecast / integrations / settings) + приветствие
// и финальный экран. Никаких деталей — только "что это и зачем".
const STEPS: Step[] = [
  {
    view: "overview",
    title: {
      EN: "Welcome to RIVANT 👋",
      UA: "Ласкаво просимо до RIVANT 👋",
      DE: "Willkommen bei RIVANT 👋",
    },
    desc: {
      EN: "A quick 1-minute tour of your dashboard. You can skip it anytime.",
      UA: "Швидкий тур кабінетом на хвилину. Пропустити можна в будь-який момент.",
      DE: "Eine kurze 1-minütige Tour durch Ihr Dashboard. Sie können sie jederzeit überspringen.",
    },
  },
  {
    view: "overview",
    title: {
      EN: "Overview",
      UA: "Огляд",
      DE: "Übersicht",
    },
    desc: {
      EN: "Your key metrics — revenue, profit, orders — updated in real time.",
      UA: "Ваші ключові метрики — виручка, прибуток, замовлення — в реальному часі.",
      DE: "Ihre wichtigsten Kennzahlen — Umsatz, Gewinn, Bestellungen — in Echtzeit.",
    },
  },
  {
    view: "risks",
    title: {
      EN: "Risks",
      UA: "Ризики",
      DE: "Risiken",
    },
    desc: {
      EN: "Issues our AI spots in your business — drops, anomalies, things worth checking.",
      UA: "Проблеми, які помічає AI: падіння показників, аномалії — те, що варто перевірити.",
      DE: "Probleme, die unsere KI erkennt — Rückgänge, Anomalien, Dinge, die einen Blick wert sind.",
    },
  },
  {
    view: "forecast",
    title: {
      EN: "Forecast",
      UA: "Прогноз",
      DE: "Prognose",
    },
    desc: {
      EN: "Where your business is heading, based on your real data — no guesswork.",
      UA: "Куди рухається ваш бізнес — на основі реальних даних, без здогадок.",
      DE: "Wohin sich Ihr Geschäft entwickelt — basierend auf echten Daten, ganz ohne Raten.",
    },
  },
  {
    view: "integrations",
    title: {
      EN: "Integrations",
      UA: "Інтеграції",
      DE: "Integrationen",
    },
    desc: {
      EN: "Connect Stripe, Shopify, Google Ads and more so RIVANT can pull in your data.",
      UA: "Підключіть Stripe, Shopify, Google Ads та інше, щоб RIVANT підтягнув ваші дані.",
      DE: "Verbinden Sie Stripe, Shopify, Google Ads und mehr, damit RIVANT Ihre Daten einbindet.",
    },
  },
  {
    view: "settings",
    title: {
      EN: "Settings",
      UA: "Налаштування",
      DE: "Einstellungen",
    },
    desc: {
      EN: "Manage your profile, notifications, language and account security here.",
      UA: "Тут керуйте профілем, сповіщеннями, мовою та безпекою акаунта.",
      DE: "Verwalten Sie hier Ihr Profil, Benachrichtigungen, Sprache und Kontosicherheit.",
    },
  },
  {
    view: null,
    title: {
      EN: "That's it!",
      UA: "Готово!",
      DE: "Das war's!",
    },
    desc: {
      EN: "You're all set — go ahead and explore RIVANT.",
      UA: "Все готово — можете досліджувати RIVANT.",
      DE: "Alles bereit — viel Erfolg beim Erkunden von RIVANT.",
    },
  },
];

const UI: Record<"next" | "back" | "skip" | "finish", Record<Language, string>> = {
  next: { EN: "Next", UA: "Далі", DE: "Weiter" },
  back: { EN: "Back", UA: "Назад", DE: "Zurück" },
  skip: { EN: "Skip", UA: "Пропустити", DE: "Überspringen" },
  finish: { EN: "Get started", UA: "Почати", DE: "Loslegen" },
};

interface OnboardingTourProps {
  language: Language;
  onNavigate: (view: ViewType) => void;
  onFinish: () => void;
}

export function OnboardingTour({ language, onNavigate, onFinish }: OnboardingTourProps) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  const goTo = (i: number) => {
    setStep(i);
    const view = STEPS[i].view;
    if (view) onNavigate(view);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-[380px] shadow-2xl p-6">
        <button
          onClick={onFinish}
          aria-label="close"
          className="absolute top-3 right-3 text-gray-500 hover:text-gray-300 p-1 rounded-lg hover:bg-gray-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* прогресс */}
        <div className="flex items-center gap-1.5 mb-4">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? "w-6 bg-blue-500" : "w-1.5 bg-gray-700"
              }`}
            />
          ))}
        </div>

        <h3 className="text-lg font-semibold text-white mb-2 pr-6">{current.title[language]}</h3>
        <p className="text-sm text-gray-400 leading-relaxed mb-6">{current.desc[language]}</p>

        <div className="flex items-center justify-between gap-2">
          <button
            onClick={onFinish}
            className="text-xs text-gray-500 hover:text-gray-300 px-2 py-2 transition-colors"
          >
            {UI.skip[language]}
          </button>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                onClick={() => goTo(step - 1)}
                className="flex items-center gap-1 text-sm text-gray-300 hover:text-white px-3 py-2 rounded-lg border border-gray-700 hover:bg-gray-800 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                {UI.back[language]}
              </button>
            )}
            <button
              onClick={() => (isLast ? onFinish() : goTo(step + 1))}
              className="flex items-center gap-1 text-sm text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-medium transition-colors"
            >
              {isLast ? UI.finish[language] : UI.next[language]}
              {!isLast && <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
