"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";

type Language = "EN" | "UA" | "DE";
type ViewType = "overview" | "risks" | "forecast" | "integrations" | "settings";
type Placement = "top" | "bottom" | "left" | "right";
// Побочный эффект шага — команда родителю открыть/закрыть что-то в UI
// (панель метрик, дропдаун фильтра, дропдаун уведомлений, демо-вид
// подключённой интеграции), чтобы тур показывал не пустую кнопку,
// а реально раскрытое содержимое.
type StepAction = "widgetPrefs" | "riskFilter" | "notificationsBell" | "integrationsDemo" | null;

interface Step {
  view: ViewType | null;
  /**
   * CSS selector of the real element to spotlight, e.g. `[data-tour="metrics-toggle"]`.
   * `null` = centered step with no target (welcome / finish screens).
   */
  target: string | null;
  placement?: Placement;
  action?: StepAction;
  /**
   * Shrinks the popover further on narrow (mobile) viewports, for steps
   * whose target is a small icon/button sitting right above a lot of other
   * content (e.g. the metrics gear) — a full-width popover placed "bottom"
   * there ends up sitting on top of the cards/chart below it instead of
   * just the small target itself.
   */
  compact?: boolean;
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
    target: '[data-tour="metrics-overview"]',
    placement: "bottom",
    title: {
      EN: "Your live metrics",
      UA: "Ваші метрики в реальному часі",
      DE: "Ihre Kennzahlen live",
    },
    desc: {
      EN: "These 4 cards and the chart below update in real time as your data comes in.",
      UA: "Ці 4 картки та графік нижче оновлюються в реальному часі, коли надходять дані.",
      DE: "Diese 4 Kacheln und das Diagramm darunter aktualisieren sich in Echtzeit.",
    },
  },
  {
    view: "overview",
    target: '[data-tour="metrics-gear"]',
    // "bottom" used to place the popover right on top of the metric cards
    // grid that sits directly under this tiny gear icon — on mobile that
    // read as the tour "covering everything". The gear scrolls to the
    // vertical center of the screen before this step opens, so there's
    // always clear room above it; "top" + `compact` keeps the popover
    // small and out of the way of the cards below.
    placement: "top",
    compact: true,
    title: {
      EN: "Choose your metrics",
      UA: "Виберіть свої метрики",
      DE: "Kennzahlen wählen",
    },
    desc: {
      EN: "Tap this gear to pick which 4 cards you see — revenue, orders, avg. order value, CAC and more.",
      UA: "Натисніть на цю шестерню, щоб вибрати, які 4 картки бачити — виручка, замовлення, середній чек, CAC тощо.",
      DE: "Tippen Sie auf dieses Zahnrad, um Ihre 4 Kacheln zu wählen — Umsatz, Bestellungen, Ø Bestellwert, CAC und mehr.",
    },
  },
  {
    view: "overview",
    target: '[data-tour="widget-prefs-content"]',
    placement: "right",
    action: "widgetPrefs",
    title: {
      EN: "Add, remove, reorder",
      UA: "Додавайте, видаляйте, змінюйте порядок",
      DE: "Hinzufügen, entfernen, neu ordnen",
    },
    desc: {
      EN: "Drag the handle to reorder, tap the X to remove a card, or tap any card below to add it — save once you've picked exactly 4.",
      UA: "Перетягуйте за ручку, щоб змінити порядок, натисніть X, щоб прибрати картку, або торкніться картки нижче, щоб додати — збережіть, коли обрано рівно 4.",
      DE: "Ziehen Sie am Griff, um die Reihenfolge zu ändern, tippen Sie auf X, um eine Kachel zu entfernen, oder auf eine Kachel unten, um sie hinzuzufügen — speichern Sie, sobald genau 4 ausgewählt sind.",
    },
  },
  {
    view: "risks",
    target: '[data-tour="risks-overview"]',
    placement: "top",
    title: {
      EN: "AI-detected risks",
      UA: "Ризики, виявлені AI",
      DE: "KI-erkannte Risiken",
    },
    desc: {
      EN: "This is where every operational risk the AI spots shows up — active first, resolved ones in History.",
      UA: "Тут з'являється кожен виявлений AI операційний ризик — спершу активні, вирішені — в Історії.",
      DE: "Hier erscheint jedes von der KI erkannte Risiko — zuerst aktive, gelöste unter Verlauf.",
    },
  },
  {
    view: "risks",
    target: '[data-tour="notifications-bell"]',
    placement: "bottom",
    title: {
      EN: "Notifications",
      UA: "Сповіщення",
      DE: "Benachrichtigungen",
    },
    desc: {
      EN: "Tap the bell anytime for a quick digest of what the AI has caught.",
      UA: "Натискайте на дзвіночок у будь-який момент для швидкого огляду того, що виявив AI.",
      DE: "Tippen Sie jederzeit auf die Glocke für eine kurze Übersicht dessen, was die KI erkannt hat.",
    },
  },
  {
    view: "risks",
    target: '[data-tour="notifications-content"]',
    placement: "left",
    action: "notificationsBell",
    title: {
      EN: "Plain-language alerts",
      UA: "Сповіщення простою мовою",
      DE: "Benachrichtigungen in einfacher Sprache",
    },
    desc: {
      EN: "Every risk the AI catches lands here first, written in plain language, with a shortcut to see all of them.",
      UA: "Кожен ризик, який виявляє AI, спершу з'являється тут — простою мовою, з переходом до перегляду всіх.",
      DE: "Jedes von der KI erkannte Risiko landet zuerst hier — in einfacher Sprache, mit einem Link zu allen.",
    },
  },
  {
    view: "risks",
    target: '[data-tour="risks-filter"]',
    placement: "bottom",
    title: {
      EN: "Filter risks",
      UA: "Фільтруйте ризики",
      DE: "Risiken filtern",
    },
    desc: {
      EN: "Tap here to narrow risks down by severity or type.",
      UA: "Натисніть тут, щоб звузити ризики за важливістю чи типом.",
      DE: "Tippen Sie hier, um Risiken nach Schweregrad oder Typ einzugrenzen.",
    },
  },
  {
    view: "risks",
    target: '[data-tour="risk-filter-content"]',
    placement: "left",
    action: "riskFilter",
    title: {
      EN: "Pick your categories",
      UA: "Оберіть категорії",
      DE: "Kategorien auswählen",
    },
    desc: {
      EN: "Check any category to show only those risks — untick all to see everything again.",
      UA: "Позначте потрібні категорії, щоб бачити лише їх — зніміть усі позначки, щоб знову бачити все.",
      DE: "Wählen Sie Kategorien aus, um nur diese Risiken zu sehen — alle abwählen zeigt wieder alles.",
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
    target: '[data-tour="forecast-stats"]',
    placement: "bottom",
    title: {
      EN: "Where you're headed",
      UA: "Куди ви рухаєтесь",
      DE: "Wohin es geht",
    },
    desc: {
      EN: "Projected revenue and expenses, extrapolated from your real spending and income trends.",
      UA: "Прогнозована виручка та витрати, екстрапольовані з реальних трендів доходів і витрат.",
      DE: "Prognostizierter Umsatz und Kosten, hochgerechnet aus Ihren echten Trends.",
    },
  },
  {
    view: "forecast",
    target: '[data-tour="forecast-chart"]',
    placement: "bottom",
    title: {
      EN: "90-day forecast",
      UA: "Прогноз на 90 днів",
      DE: "90-Tage-Prognose",
    },
    desc: {
      EN: "This demo shows what the chart looks like with a few months of history — yours will fill in as data comes in.",
      UA: "Це демо показує, як виглядає графік з кількамісячною історією — ваш заповниться, коли накопичаться дані.",
      DE: "Diese Demo zeigt das Diagramm mit einigen Monaten Historie — Ihres füllt sich, sobald Daten eingehen.",
    },
  },
  {
    view: "forecast",
    target: '[data-tour="forecast-ai-analysis"]',
    placement: "top",
    title: {
      EN: "AI analysis",
      UA: "Аналіз від AI",
      DE: "KI-Analyse",
    },
    desc: {
      EN: "A plain-language read of the trend — again, demo data here, but this is exactly what you'll see with your own numbers.",
      UA: "Пояснення тренду простою мовою — тут демо-дані, але це саме те, що ви побачите зі своїми цифрами.",
      DE: "Eine Erklärung des Trends in einfacher Sprache — hier Demo-Daten, aber genauso sieht es mit Ihren eigenen Zahlen aus.",
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
    view: "integrations",
    target: '[data-tour="integrations-demo-connected"]',
    placement: "bottom",
    action: "integrationsDemo",
    title: {
      EN: "See a live integration",
      UA: "Подивіться підключену інтеграцію",
      DE: "Live-Integration ansehen",
    },
    desc: {
      EN: "Here's what Stripe looks like once it's connected — a live sync status and the exact revenue key we're pulling from, no guesswork.",
      UA: "Ось як виглядає Stripe після підключення — статус синхронізації в реальному часі та точний ключ виручки, який ми тягнемо.",
      DE: "So sieht Stripe nach der Verbindung aus — Live-Sync-Status und der genaue Umsatzschlüssel, den wir abrufen.",
    },
  },
  {
    view: "settings",
    target: '[data-tour="settings-notifications"]',
    placement: "bottom",
    title: {
      EN: "Notifications & digest",
      UA: "Сповіщення та дайджест",
      DE: "Benachrichtigungen & Digest",
    },
    desc: {
      EN: "Toggle Push and Email to control where alerts land, set how sensitive they are, and how often you get a summary.",
      UA: "Перемикачі Push і Email визначають, куди приходять сповіщення; нижче — чутливість алертів і частота дайджесту.",
      DE: "Push und E-Mail bestimmen, wo Benachrichtigungen ankommen; darunter Empfindlichkeit und Digest-Häufigkeit.",
    },
  },
  {
    view: "settings",
    target: '[data-tour="settings-telegram"]',
    placement: "bottom",
    title: {
      EN: "Telegram alerts",
      UA: "Сповіщення в Telegram",
      DE: "Telegram-Benachrichtigungen",
    },
    desc: {
      EN: "Tap Connect to link a Telegram bot and get risk alerts instantly, even with the dashboard closed.",
      UA: "Натисніть «Підключити», щоб прив'язати Telegram-бота й отримувати сповіщення про ризики миттєво, навіть коли дашборд закрито.",
      DE: "Tippen Sie auf Verbinden, um einen Telegram-Bot zu verknüpfen und Risikowarnungen sofort zu erhalten — auch bei geschlossenem Dashboard.",
    },
  },
  {
    view: "settings",
    target: '[data-tour="settings-security"]',
    placement: "left",
    title: {
      EN: "Two-factor auth & password",
      UA: "Двофакторна автентифікація та пароль",
      DE: "Zwei-Faktor-Authentifizierung & Passwort",
    },
    desc: {
      EN: "Flip the switch to require a code at login, or tap Update next to Change Password to set a new one.",
      UA: "Увімкніть перемикач, щоб вимагати код при вході, або натисніть «Оновити» біля зміни пароля.",
      DE: "Aktivieren Sie den Schalter für einen Login-Code oder tippen Sie bei Passwort ändern auf Aktualisieren.",
    },
  },
  {
    view: "settings",
    target: '[data-tour="settings-feedback"]',
    placement: "top",
    title: {
      EN: "Tell us what you think",
      UA: "Розкажіть, що ви думаєте",
      DE: "Sagen Sie uns Ihre Meinung",
    },
    desc: {
      EN: "Loved something, hated something, want a feature? Leave a review here — it genuinely shapes what we build next.",
      UA: "Щось сподобалось, щось ні, бракує функції? Залиште відгук тут — це справді впливає на те, що ми робимо далі.",
      DE: "Etwas gefällt Ihnen, etwas nicht, fehlt ein Feature? Schreiben Sie eine Bewertung — sie beeinflusst wirklich, was wir als Nächstes bauen.",
    },
  },
  {
    view: "settings",
    target: '[data-tour="settings-report-issue"]',
    placement: "top",
    title: {
      EN: "Found a bug — or missing a feature?",
      UA: "Знайшли баг — чи бракує функції?",
      DE: "Fehler gefunden — oder fehlt ein Feature?",
    },
    desc: {
      EN: "Switch between Bug and Feature request here. Report what's broken, or pitch a feature you'd like to see — either way, the more detail, the faster we act on it.",
      UA: "Перемикайтесь між «Проблема» і «Пропозиція функції» тут. Повідомте, що зламалось, або запропонуйте функцію, якої бракує — що детальніше, то швидше ми відреагуємо.",
      DE: "Wechseln Sie hier zwischen Fehler und Funktionsvorschlag. Melden Sie, was kaputt ist, oder schlagen Sie ein gewünschtes Feature vor — je mehr Details, desto schneller reagieren wir.",
    },
  },
  {
    view: "settings",
    target: '[data-tour="settings-danger-zone"]',
    placement: "bottom",
    title: {
      EN: "Export or delete your data",
      UA: "Експорт або видалення даних",
      DE: "Daten exportieren oder löschen",
    },
    desc: {
      EN: "Export downloads everything as JSON, Excel or PDF for a period you choose. Delete account is permanent — there's no undo.",
      UA: "Експорт вивантажує все у JSON, Excel або PDF за обраний період. Видалення акаунта незворотне — скасувати не можна.",
      DE: "Export lädt alles als JSON, Excel oder PDF für den gewählten Zeitraum. Konto löschen ist endgültig — keine Rückgängig-Funktion.",
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

const UI: Record<"next" | "back" | "skip" | "finish" | "scrollForMore", Record<Language, string>> = {
  next: { EN: "Next", UA: "Далі", DE: "Weiter" },
  back: { EN: "Back", UA: "Назад", DE: "Zurück" },
  skip: { EN: "Skip", UA: "Пропустити", DE: "Überspringen" },
  finish: { EN: "Get started", UA: "Почати", DE: "Loslegen" },
  // Shown next to the bouncing chevron when the spotlighted card is taller
  // than the screen (see `clippedAtBottom`) — the chevron alone reads as
  // decoration to a lot of people, who then never realize the rest of the
  // block is still there, one scroll away.
  scrollForMore: { EN: "Scroll for more", UA: "Прокрутіть, щоб побачити ще", DE: "Scrollen für mehr" },
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

// A thin, continuous progress bar reads as "almost there" at any step count,
// where a wall of per-step dots (or even a sliding window of them) still
// telegraphs "this is a long tour" and invites an immediate Skip. This is
// the same pattern used for onboarding in most polished mobile products
// (Duolingo lessons, Stripe/Linear setup flows) — one clean signal of
// progress, a tiny numeric label for people who want the exact count, done.
function ProgressBar({ step, total, isNarrow }: { step: number; total: number; isNarrow: boolean }) {
  const pct = Math.round(((step + 1) / total) * 100);
  return (
    <div className={`flex items-center gap-2 pr-6 ${isNarrow ? "mb-2.5" : "mb-4"}`}>
      <div className="flex-1 h-1 rounded-full bg-gray-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-[width] duration-500"
          style={{ width: `${pct}%`, transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
        />
      </div>
      <span className={`text-gray-600 font-medium tabular-nums shrink-0 ${isNarrow ? "text-[10px]" : "text-[11px]"}`}>
        {step + 1}/{total}
      </span>
    </div>
  );
}

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

  // Guards against a second navigation firing while the current step hasn't
  // finished drawing yet (rapid double-clicks on Next/Back). Without this,
  // two overlapping measure() runs can race and the spotlight ends up on
  // the wrong element for a frame.
  const goTo = (i: number) => {
    if (!ready) return;
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

  // Safety net: some Radix components (Popover/DropdownMenu with default
  // modal={true}) lock `pointer-events: none` on <body> while open and
  // release it themselves on close. Since the tour opens/closes those
  // programmatically (not via the user's own click/escape), that release
  // can race with the tour's own re-render and get stuck, freezing every
  // click on the page including the tour's own Next/Back/Skip/X buttons.
  // Force-clear it on every step change and on unmount so a stuck lock
  // never survives past the step that caused it.
  useEffect(() => {
    if (typeof document !== "undefined" && document.body.style.pointerEvents === "none") {
      document.body.style.pointerEvents = "";
    }
    return () => {
      if (typeof document !== "undefined" && document.body.style.pointerEvents === "none") {
        document.body.style.pointerEvents = "";
      }
    };
  }, [step]);

  // Locate + measure the target element. Retries for a bit in case the
  // tab we just navigated to (or a panel we just asked the parent to open)
  // is still mounting/animating in. Once found, a ResizeObserver keeps
  // tracking it — this is what used to go stale when a block finished
  // loading (skeleton -> real content) without a window resize/scroll.
  useLayoutEffect(() => {
    let cancelled = false;
    let tries = 0;
    let ro: ResizeObserver | null = null;
    let mo: MutationObserver | null = null;
    targetElRef.current = null;

    const attachObserver = (el: Element) => {
      ro?.disconnect();
      mo?.disconnect();
      const remeasure = () => {
        if (cancelled) return;
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      };
      ro = new ResizeObserver(remeasure);
      ro.observe(el);
      // Radix popovers (notifications bell dropdown, risk filter panel, ...)
      // are positioned by floating-ui via an inline `style` (transform/top/
      // left) that's applied ASYNCHRONOUSLY after the node mounts — it can
      // shift position without changing size at all, which a ResizeObserver
      // never sees. That's what made the spotlight sit slightly off from
      // the actual panel on some phones (measured before floating-ui's
      // final position landed, then never corrected). Watching `style`
      // catches that repositioning too.
      mo = new MutationObserver(remeasure);
      mo.observe(el, { attributes: true, attributeFilter: ["style"] });
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
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        // Two rAFs (not zero) so any Radix/floating-ui positioning pass
        // that runs right after this element mounts has already landed
        // before we take the first measurement — see attachObserver above
        // for why a later correction alone isn't enough (no resize fires).
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (cancelled) return;
            const r = el.getBoundingClientRect();
            setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
            attachObserver(el);
            revealWhenMeasured();
          });
        });
        return;
      }

      tries += 1;
      if (tries < 30) {
        setTimeout(measure, 50);
      } else {
        // couldn't find it — fall back to a centered popover rather than
        // leaving the tour stuck
        setRect(null);
        revealWhenMeasured();
      }
    };

    // Reveals the step only once BOTH the spotlight position (rect, set just
    // before this is called) AND the popover's real height for the CURRENT
    // step's content have been measured. Previously popoverH was updated by
    // an independent ResizeObserver that could fire either before or after
    // `ready` flipped to true — that race is exactly what caused the popup
    // to visibly jump to its correct spot right after appearing. Measuring
    // here, synchronously with the reveal, removes the race: nothing is
    // shown until its final position is already known.
    const revealWhenMeasured = () => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        requestAnimationFrame(() => {
          if (cancelled) return;
          const h = popoverRef.current?.getBoundingClientRect().height;
          if (h) setPopoverH(Math.ceil(h));
          setReady(true);
        });
      });
    };

    measure();
    return () => {
      cancelled = true;
      ro?.disconnect();
      mo?.disconnect();
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

  const viewportW = typeof window !== "undefined" ? window.innerWidth : 1280;
  const isNarrow = viewportW < 480;

  const spotlight = rect
    ? (() => {
        const vw = viewportW;
        const vh = typeof window !== "undefined" ? window.innerHeight : 800;
        const rawTop = rect.top - PAD;
        const rawLeft = rect.left - PAD;
        const rawRight = rect.left + rect.width + PAD;
        const rawBottom = rect.top + rect.height + PAD;
        // Clip the highlighted rect to the viewport. Some tour targets can be
        // taller/wider than the screen (a long card list, a full-height
        // panel). An unclipped spotlight forces the browser to animate a
        // `box-shadow: 0 0 0 9999px` cutout across that whole oversized
        // region every step — expensive enough on some mobile/desktop GPUs
        // to hang or crash the tab's renderer. Clipping bounds the worst
        // case to the viewport regardless of the real element size.
        const left = Math.max(rawLeft, 0);
        const right = Math.min(rawRight, vw);

        // A target taller than the viewport itself (a mobile bottom sheet
        // like the widget-prefs panel, or a tall settings card) clips to
        // top=0/bottom=vh on both ends — the "spotlight" then covers the
        // *entire* screen, which visually just traces a border around the
        // whole viewport instead of a sensible sub-area, and leaves nowhere
        // on-screen to draw the popover without sitting on top of it. When
        // that happens, reserve a strip at the bottom exactly the size of
        // the popover (+gaps) so there's always a clean, dedicated spot for
        // it — the popover's own "bottom" placement below then fits without
        // any extra logic. `clippedAtBottom` tells the UI to show a hint
        // that the card continues below what's currently spotlighted.
        const oversized = rawTop < 0 && rawBottom > vh;
        const top = Math.max(rawTop, 0);
        let bottom = Math.min(rawBottom, vh);
        let clippedAtBottom = false;
        if (oversized) {
          const reserved = popoverH + GAP + EDGE;
          const maxBottom = Math.max(vh - reserved, top + 80);
          if (bottom > maxBottom) {
            bottom = maxBottom;
            clippedAtBottom = true;
          }
        }
        return {
          top,
          left,
          width: Math.max(right - left, 0),
          height: Math.max(bottom - top, 0),
          clippedAtBottom,
        };
      })()
    : null;

  // On narrow (mobile) viewports the fixed 300px popover is nearly as wide
  // as the screen itself, so we shrink it — and shrink it a bit further
  // still, with tighter padding/type, so it reads as a compact hint rather
  // than another panel competing with whatever it's pointing at. Steps
  // flagged `compact` (small targets sitting right above other content,
  // e.g. the metrics gear) shrink further still on mobile, since even the
  // 260px popover was enough to spill over the cards underneath.
  const basePopoverW = isNarrow ? (current.compact ? 200 : 240) : POPOVER_W;
  const popoverW = Math.min(basePopoverW, viewportW - EDGE * 2);

  const popoverStyle = getPopoverStyle(spotlight, current.placement, popoverH, popoverW);

  return (
    <div className="fixed inset-0 z-[200]" style={{ opacity: ready ? 1 : 0, transition: "opacity 250ms cubic-bezier(0.16, 1, 0.3, 1)" }}>
      {/* dim everything except the spotlight cutout, with a soft two-layer
          glow around the cutout (thin crisp ring + diffuse blue halo)
          instead of a flat hard border — reads as a deliberate highlight
          rather than a debug outline. No blur on the cutout itself. */}
      <div
        className="absolute inset-0 pointer-events-none transition-all duration-500"
        style={{
          transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
          boxShadow: spotlight
            ? `0 0 0 9999px rgba(8,10,16,0.68), 0 0 0 1.5px rgba(96,165,250,0.95), 0 0 0 5px rgba(59,130,246,0.18), 0 0 24px 2px rgba(59,130,246,0.25)`
            : "none",
          background: spotlight ? "transparent" : "rgba(8,10,16,0.68)",
          top: spotlight ? spotlight.top : 0,
          left: spotlight ? spotlight.left : 0,
          width: spotlight ? spotlight.width : "100%",
          height: spotlight ? spotlight.height : "100%",
          borderRadius: spotlight ? 14 : 0,
        }}
      />

      {/* hint that the spotlighted card continues below the visible cutout
          (see `clippedAtBottom` above) — a small bouncing chevron so people
          on mobile don't miss the rest of a tall settings/panel block. */}
      {spotlight?.clippedAtBottom && (
        <div
          className="absolute flex justify-center pointer-events-none"
          style={{ top: spotlight.top + spotlight.height - 14, left: spotlight.left, width: spotlight.width }}
        >
          <div className="flex items-center gap-1.5 bg-blue-500 text-white rounded-full pl-2.5 pr-1 py-1 shadow-lg animate-bounce">
            <span className="text-[10px] font-medium leading-none whitespace-nowrap">{UI.scrollForMore[language]}</span>
            <ChevronDown className="w-3 h-3 shrink-0" />
          </div>
        </div>
      )}

      {/* click-catcher so the rest of the page doesn't receive clicks mid-tour */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      {/* floating popover — fades/scales in only once its final position
          and height are already known (see revealWhenMeasured), so this
          transform never has to "correct" itself after appearing. */}
      <div
        ref={popoverRef}
        className={`absolute bg-gray-900 border border-gray-800 ring-1 ring-white/[0.04] shadow-2xl transition-all ${
          isNarrow ? "p-2.5 rounded-xl" : "p-5 rounded-2xl"
        }`}
        style={{
          width: popoverW,
          ...popoverStyle,
          transitionDuration: "420ms",
          transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
          opacity: ready ? 1 : 0,
          transform: `${popoverStyle.transform ?? ""} ${ready ? "scale(1) translateY(0)" : "scale(0.96) translateY(6px)"}`.trim(),
        }}
      >
        <button
          onClick={onFinish}
          aria-label="close"
          className={`absolute text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-800 transition-colors ${
            isNarrow ? "top-2 right-2 p-0.5" : "top-3 right-3 p-1"
          }`}
        >
          <X className={isNarrow ? "w-3.5 h-3.5" : "w-4 h-4"} />
        </button>

        <ProgressBar step={step} total={STEPS.length} isNarrow={isNarrow} />

        <h3 className={`font-semibold text-white pr-6 ${isNarrow ? "text-xs mb-1" : "text-base mb-1.5"}`}>{current.title[language]}</h3>
        <p className={`text-gray-400 leading-relaxed pr-6 ${isNarrow ? "text-[11px] mb-2.5" : "text-sm mb-5"}`}>{current.desc[language]}</p>

        <div className="flex items-center justify-between gap-2">
          <button
            onClick={onFinish}
            className={`text-gray-500 hover:text-gray-300 transition-colors ${isNarrow ? "text-[11px] px-1 py-1.5" : "text-xs px-2 py-2"}`}
          >
            {UI.skip[language]}
          </button>
          <div className={`flex items-center ${isNarrow ? "gap-1.5" : "gap-2"}`}>
            {!isFirst && (
              <button
                onClick={() => goTo(step - 1)}
                disabled={!ready}
                className={`flex items-center gap-1 text-gray-300 hover:text-white rounded-lg border border-gray-700 hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                  isNarrow ? "text-xs px-2 py-1.5" : "text-sm px-3 py-2"
                }`}
              >
                <ChevronLeft className={isNarrow ? "w-3.5 h-3.5" : "w-4 h-4"} />
                {UI.back[language]}
              </button>
            )}
            <button
              onClick={() => (isLast ? onFinish() : goTo(step + 1))}
              disabled={!ready}
              className={`flex items-center gap-1 text-white bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                isNarrow ? "text-xs px-2.5 py-1.5" : "text-sm px-4 py-2"
              }`}
            >
              {isLast ? UI.finish[language] : UI.next[language]}
              {!isLast && <ChevronRight className={isNarrow ? "w-3.5 h-3.5" : "w-4 h-4"} />}
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
  popoverH: number,
  popoverW: number = POPOVER_W
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
          left: spotlight.left + spotlight.width / 2 - popoverW / 2,
        };
      case "top":
        return {
          top: spotlight.top - GAP - popoverH,
          left: spotlight.left + spotlight.width / 2 - popoverW / 2,
        };
      case "left":
        return {
          top: spotlight.top + spotlight.height / 2 - popoverH / 2,
          left: spotlight.left - popoverW - GAP,
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
    left: Math.max(EDGE, Math.min(pos.left, vw - popoverW - EDGE)),
  });

  const fitsCleanly = (pos: { top: number; left: number }) => {
    // Fits on-screen without clamping AND doesn't overlap the spotlight.
    const onScreen =
      pos.top >= EDGE && pos.left >= EDGE && pos.top + popoverH <= vh - EDGE && pos.left + popoverW <= vw - EDGE;
    if (!onScreen) return false;
    return !rectsOverlap({ top: pos.top, left: pos.left, width: popoverW, height: popoverH }, spotlight);
  };

  // Try the requested placement, then its opposite, then the two remaining
  // sides.
  const order: Placement[] = [placement, OPPOSITE[placement], "bottom", "top", "right", "left"];
  for (const p of order) {
    const pos = place(p);
    if (fitsCleanly(pos)) return clamp(pos);
  }

  // Nothing "fits cleanly" (typical on narrow mobile viewports where the
  // popover is nearly as wide as the screen). Rather than blindly clamping
  // the originally requested placement — which can land the popover right
  // on top of the spotlighted element — force it fully above or below,
  // whichever side has more room, and clamp only horizontally. This never
  // overlaps the spotlight vertically.
  const spaceBelow = vh - (spotlight.top + spotlight.height) - GAP;
  const spaceAbove = spotlight.top - GAP;
  const top =
    spaceBelow >= spaceAbove
      ? Math.min(spotlight.top + spotlight.height + GAP, vh - popoverH - EDGE)
      : Math.max(spotlight.top - GAP - popoverH, EDGE);

  return clamp({ top, left: place(placement).left });
}