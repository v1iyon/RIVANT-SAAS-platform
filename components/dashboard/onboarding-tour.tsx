"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

type Language = "EN" | "UA" | "DE";
type ViewType = "overview" | "risks" | "forecast" | "integrations" | "settings";
type Placement = "top" | "bottom" | "left" | "right";
// Побочный эффект шага — команда родителю открыть/закрыть что-то в UI
// (панель метрик, дропдаун фильтра), чтобы тур показывал не пустую кнопку,
// а реально раскрытое содержимое.
type StepAction = "widgetPrefs" | "riskFilter" | null;

interface Step {
  view: ViewType | null;
  /**
   * CSS selector of the real element to spotlight, e.g. `[data-tour="metrics-toggle"]`.
   * `null` = centered step with no target (welcome / finish screens).
   */
  target: string | null;
  placement?: Placement;
  action?: StepAction;
  title: Record<Language, string>;
  desc: Record<Language, string>;
}

const STEPS: Step[] = [
  {
    view: "overview",
    target: null,
    title: {
      EN: "Welcome to RIVANT 👋",
      UA: "Ласкаво просимо до RIVANT 👋",
      DE: "Willkommen bei RIVANT 👋",
    },
    desc: {
      EN: "A quick 1-minute tour. You can skip it anytime.",
      UA: "Швидкий тур на хвилину. Пропустити можна в будь-який момент.",
      DE: "Eine kurze 1-minütige Tour. Sie können jederzeit überspringen.",
    },
  },
  {
    view: "overview",
    target: '[data-tour="metrics-gear"]',
    placement: "bottom",
    action: "widgetPrefs",
    title: {
      EN: "Choose your metrics",
      UA: "Виберіть свої метрики",
      DE: "Kennzahlen wählen",
    },
    desc: {
      EN: "Tap the gear to pick which 4 cards you see — revenue, orders, avg. order value, CAC and more.",
      UA: "Натисніть на шестерню, щоб вибрати, які 4 картки бачити — виручка, замовлення, середній чек, CAC тощо.",
      DE: "Tippen Sie auf das Zahnrad, um Ihre 4 Kacheln zu wählen — Umsatz, Bestellungen, Ø Bestellwert, CAC und mehr.",
    },
  },
  {
    view: "risks",
    target: '[data-tour="risks-filter"]',
    placement: "bottom",
    action: "riskFilter",
    title: {
      EN: "Filter risks",
      UA: "Фільтруйте ризики",
      DE: "Risiken filtern",
    },
    desc: {
      EN: "Narrow down by severity or type right here.",
      UA: "Звужуйте за важливістю чи типом прямо тут.",
      DE: "Hier nach Schweregrad oder Typ eingrenzen.",
    },
  },
  {
    view: "risks",
    target: '[data-tour="risks-history"]',
    placement: "bottom",
    title: {
      EN: "Risk history",
      UA: "Історія ризиків",
      DE: "Risikoverlauf",
    },
    desc: {
      EN: "Everything the AI has flagged over time lives here.",
      UA: "Все, що AI помітив з часом, зберігається тут.",
      DE: "Alles, was die KI im Zeitverlauf erkannt hat.",
    },
  },
  {
    view: "forecast",
    target: '[data-tour="forecast-chart"]',
    placement: "bottom",
    title: {
      EN: "Forecast",
      UA: "Прогноз",
      DE: "Prognose",
    },
    desc: {
      EN: "Where things are headed, based on your real data.",
      UA: "Куди рухається бізнес — на основі реальних даних.",
      DE: "Wohin es geht — basierend auf echten Daten.",
    },
  },
  {
    view: "integrations",
    target: '[data-tour="integrations-list"]',
    placement: "right",
    title: {
      EN: "Integrations",
      UA: "Інтеграції",
      DE: "Integrationen",
    },
    desc: {
      EN: "Connect Stripe, Shopify, Google Ads and more.",
      UA: "Підключіть Stripe, Shopify, Google Ads та інше.",
      DE: "Stripe, Shopify, Google Ads und mehr verbinden.",
    },
  },
  {
    view: "settings",
    target: '[data-tour="settings-security"]',
    placement: "left",
    title: {
      EN: "Settings",
      UA: "Налаштування",
      DE: "Einstellungen",
    },
    desc: {
      EN: "Profile, notifications, language, security — all here.",
      UA: "Профіль, сповіщення, мова, безпека — все тут.",
      DE: "Profil, Benachrichtigungen, Sprache, Sicherheit.",
    },
  },
  {
    view: null,
    target: null,
    title: {
      EN: "That's it!",
      UA: "Готово!",
      DE: "Das war's!",
    },
    desc: {
      EN: "You're all set — go ahead and explore RIVANT.",
      UA: "Все готово — можете досліджувати RIVANT.",
      DE: "Alles bereit — viel Erfolg beim Erkunden.",
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
  /** Called whenever the current step changes, with that step's `action`
   *  (or null when the step has none). The parent is responsible for
   *  opening/closing the relevant panel/dropdown and should treat `null`
   *  as "close whatever the tour previously opened". */
  onStepAction?: (action: StepAction) => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8; // spotlight padding around the target element
const GAP = 14; // gap between spotlight and popover
const POPOVER_W = 300;
const EDGE = 12; // min distance from viewport edge
const DEFAULT_POPOVER_H = 190; // best guess before the popover has ever been measured

function rectsOverlap(a: { top: number; left: number; width: number; height: number }, b: Rect) {
  return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
}

const OPPOSITE: Record<Placement, Placement> = { top: "bottom", bottom: "top", left: "right", right: "left" };

export function OnboardingTour({ language, onNavigate, onFinish, onStepAction }: OnboardingTourProps) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [popoverH, setPopoverH] = useState(DEFAULT_POPOVER_H);
  const [ready, setReady] = useState(false); // avoids a flash at 0,0 / wrong size before first measure
  const popoverRef = useRef<HTMLDivElement>(null);
  const targetElRef = useRef<Element | null>(null);

  const current = STEPS[step];
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  const goTo = (i: number) => {
    setReady(false);
    setStep(i);
    const view = STEPS[i].view;
    if (view) onNavigate(view);
  };

  // Fire the step's side-effect (open a panel/dropdown) whenever we land on
  // a new step, and clear it on unmount so nothing is left open behind us.
  useEffect(() => {
    onStepAction?.(current.action ?? null);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      onStepAction?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Locate + measure the target element. Retries for a bit in case the
  // tab we just navigated to (or a panel we just asked the parent to open)
  // is still mounting/animating in. Once found, a ResizeObserver keeps
  // tracking it — this is what used to go stale when a block finished
  // loading (skeleton -> real content) without a window resize/scroll.
  useLayoutEffect(() => {
    let cancelled = false;
    let tries = 0;
    let ro: ResizeObserver | null = null;
    targetElRef.current = null;

    const attachObserver = (el: Element) => {
      ro?.disconnect();
      ro = new ResizeObserver(() => {
        if (cancelled) return;
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      });
      ro.observe(el);
    };

    const measure = () => {
      if (cancelled) return;
      const selector = current.target;

      if (!selector) {
        setRect(null);
        setReady(true);
        return;
      }

      const el = document.querySelector(selector);
      if (el) {
        targetElRef.current = el;
        const r = el.getBoundingClientRect();
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        attachObserver(el);
        // Give the browser a beat to finish the smooth-scroll / any layout
        // shift from a panel we just opened before revealing the popover,
        // so it doesn't render at position 0 and jump.
        requestAnimationFrame(() => requestAnimationFrame(() => !cancelled && setReady(true)));
        return;
      }

      tries += 1;
      if (tries < 30) {
        setTimeout(measure, 50);
      } else {
        // couldn't find it — fall back to a centered popover rather than
        // leaving the tour stuck
        setRect(null);
        setReady(true);
      }
    };

    measure();
    return () => {
      cancelled = true;
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Keep the spotlight glued to the target on page resize/scroll (the
  // ResizeObserver above handles the target's own size changes).
  useEffect(() => {
    if (!current.target) return;
    const onUpdate = () => {
      const el = targetElRef.current || document.querySelector(current.target as string);
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    window.addEventListener("resize", onUpdate);
    window.addEventListener("scroll", onUpdate, true);
    return () => {
      window.removeEventListener("resize", onUpdate);
      window.removeEventListener("scroll", onUpdate, true);
    };
  }, [current.target]);

  // Track the popover's *real* rendered height (varies a lot by language —
  // Ukrainian/German copy runs longer than English) instead of guessing.
  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = Math.ceil(entry.contentRect.height);
        if (h > 0) setPopoverH((prev) => (prev !== h ? h : prev));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [step]);

  const spotlight = rect
    ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
    : null;

  const popoverStyle = getPopoverStyle(spotlight, current.placement, popoverH);

  return (
    <div className="fixed inset-0 z-[200]" style={{ opacity: ready ? 1 : 0, transition: "opacity 150ms" }}>
      {/* dim everything except the spotlight cutout — no blur */}
      <div
        className="absolute inset-0 pointer-events-none transition-all duration-300 ease-out"
        style={{
          boxShadow: spotlight
            ? `0 0 0 9999px rgba(0,0,0,0.55)`
            : "none",
          background: spotlight ? "transparent" : "rgba(0,0,0,0.55)",
          top: spotlight ? spotlight.top : 0,
          left: spotlight ? spotlight.left : 0,
          width: spotlight ? spotlight.width : "100%",
          height: spotlight ? spotlight.height : "100%",
          borderRadius: spotlight ? 12 : 0,
          border: spotlight ? "2px solid rgba(59,130,246,0.9)" : "none",
        }}
      />

      {/* click-catcher so the rest of the page doesn't receive clicks mid-tour */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      {/* floating popover */}
      <div
        ref={popoverRef}
        className="absolute bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl p-5 transition-all duration-300 ease-out"
        style={{ width: POPOVER_W, ...popoverStyle }}
      >
        <button
          onClick={onFinish}
          aria-label="close"
          className="absolute top-3 right-3 text-gray-500 hover:text-gray-300 p-1 rounded-lg hover:bg-gray-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-1.5 mb-3">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? "w-6 bg-blue-500" : "w-1.5 bg-gray-700"
              }`}
            />
          ))}
        </div>

        <h3 className="text-base font-semibold text-white mb-1.5 pr-6">{current.title[language]}</h3>
        <p className="text-sm text-gray-400 leading-relaxed mb-5">{current.desc[language]}</p>

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

// Positions the popover next to the spotlight (or centered, if there's no
// target), preferring `placement` but flipping to whichever side actually
// fits without overlapping the spotlight or spilling off-screen. Uses the
// *measured* popover height (popoverH) rather than a guess, since content
// length varies a lot between EN/UA/DE.
function getPopoverStyle(
  spotlight: Rect | null,
  placement: Placement = "bottom",
  popoverH: number
): React.CSSProperties {
  if (!spotlight) {
    return {
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
    };
  }

  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;

  const place = (p: Placement): { top: number; left: number } => {
    switch (p) {
      case "bottom":
        return {
          top: spotlight.top + spotlight.height + GAP,
          left: spotlight.left + spotlight.width / 2 - POPOVER_W / 2,
        };
      case "top":
        return {
          top: spotlight.top - GAP - popoverH,
          left: spotlight.left + spotlight.width / 2 - POPOVER_W / 2,
        };
      case "left":
        return {
          top: spotlight.top + spotlight.height / 2 - popoverH / 2,
          left: spotlight.left - POPOVER_W - GAP,
        };
      case "right":
        return {
          top: spotlight.top + spotlight.height / 2 - popoverH / 2,
          left: spotlight.left + spotlight.width + GAP,
        };
    }
  };

  const clamp = (pos: { top: number; left: number }) => ({
    top: Math.max(EDGE, Math.min(pos.top, vh - popoverH - EDGE)),
    left: Math.max(EDGE, Math.min(pos.left, vw - POPOVER_W - EDGE)),
  });

  const fitsCleanly = (pos: { top: number; left: number }) => {
    // Fits on-screen without clamping AND doesn't overlap the spotlight.
    const onScreen =
      pos.top >= EDGE && pos.left >= EDGE && pos.top + popoverH <= vh - EDGE && pos.left + POPOVER_W <= vw - EDGE;
    if (!onScreen) return false;
    return !rectsOverlap({ top: pos.top, left: pos.left, width: POPOVER_W, height: popoverH }, spotlight);
  };

  // Try the requested placement, then its opposite, then the two remaining
  // sides, and finally fall back to a clamped version of the first choice.
  const order: Placement[] = [placement, OPPOSITE[placement], "bottom", "top", "right", "left"];
  for (const p of order) {
    const pos = place(p);
    if (fitsCleanly(pos)) return clamp(pos);
  }
  return clamp(place(placement));
}
