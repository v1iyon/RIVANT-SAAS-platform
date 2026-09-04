"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle, AlertCircle, Lock } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { getMaxSlots, getIntegrationLockReason } from "@/lib/plan-slots";

type LockReason = "expired" | "plan" | "selection" | null;

interface Props {
  email: string;
  provider: string;
  displayName: string;
  placeholder: string;
  hint: string;
  isExpiredTrial?: boolean;
  // Кількість слотів залежить від тарифу (див. lib/plan-slots.js):
  // "starter" — 1 слот, "growth" — 2, "scale"/"trial" — без обмежень,
  // null/невідомий тариф — 0 (немає активної підписки).
  planTier?: string | null;
  // Поточний зафіксований вибір на billing-період (з subscriptions.integrations_selected).
  selectedProviders?: string[];
  onLockedClick?: () => void;
  // Викликається після успішного підключення, якщо на цьому тарифі ще був
  // вільний слот — щоб батьківський компонент одразу оновив selectedProviders
  // (повний, змерджений масив, а не тільки цей provider) і заблокував інші
  // картки без релоаду. Раніше сюди передавався лише один provider і
  // батьківський стан ПЕРЕЗАПИСУВАВСЯ (setSelectedProviders([p])) — це
  // губило раніше обраний слот на Growth (2 слоти) при підключенні другого
  // провайдера. Тепер картка сама рахує змерджений масив і віддає його.
  onSelected?: (providers: string[]) => void;
  // Деяким провайдерам (Shopify — домен магазину, Meta Ads — Ad Account ID) мало
  // самого ключа. Якщо задано — рендериться друге поле, обов'язкове для підключення.
  extraField?: { key: string; label: string; placeholder: string };
  // Google Ads потребує одразу кількох полів (Customer ID, OAuth Client ID/Secret,
  // Developer Token) на додачу до refresh token в основному полі — використовуємо
  // це замість extraField, коли треба більше одного додаткового поля.
  extraFields?: { key: string; label: string; placeholder: string }[];
  // Якщо задано — картка показує кнопку "Підключити через Google" (редірект на
  // /api/auth/google-ads/start), а не ручні поля. Ручний ввід Client ID/Secret/
  // Developer Token/refresh token більше не потрібен — все це налаштоване
  // app-wide на сервері, користувач лише проходить Google consent screen.
  oauthStartHref?: string;
  oauthButtonLabel?: string;
  // Тільки для Shopify: чекбокс "це окремий потік грошей" -> config.revenue_mode.
  // Не показаний -> revenue_mode взагалі не передається -> бекенд трактує це
  // як дефолтний "replace" (Shopify заміщує Stripe для цієї дати, безпечний
  // дефолт проти задвоєння доходу).
  showRevenueModeCheckbox?: boolean;
  refreshToken?: number;
  syncFailed?: boolean;
}

export function IntegrationConnectCard({
  email,
  provider,
  displayName,
  placeholder,
  hint,
  isExpiredTrial = false,
  planTier = null,
  selectedProviders = [],
  onLockedClick,
  onSelected,
  extraField,
  extraFields,
  oauthStartHref,
  oauthButtonLabel,
  showRevenueModeCheckbox = false,
  refreshToken = 0,
  syncFailed = false,
}: Props) {
  const { language } = useLanguage();
  const [revenueModeAdd, setRevenueModeAdd] = useState(false);
  const [revenueModeSaving, setRevenueModeSaving] = useState(false);
  // Нормалізуємо обидва варіанти (одне поле / кілька полів) в один масив,
  // щоб решта компонента не знала про різницю.
  const fields = extraFields ?? (extraField ? [extraField] : []);
  const [apiKey, setApiKey] = useState("");
  const [extraValues, setExtraValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"checking" | "idle" | "loading" | "connected" | "error">("checking");
  const [errorMsg, setErrorMsg] = useState("");
  // Персистентний прапорець з БД (integrations.status === "error"): бейдж і
  // форма переприв'язки орієнтуються саме на нього і тримаються, доки
  // наступний реальний синк (крон чи ручний) не пройде успішно.
  const [hasSyncError, setHasSyncError] = useState(false);
  // Конкретна причина з бекенду (лише Shopify пише її в config.sync_error_reason;
  // інші провайдери — generic-повідомлення за замовчуванням).
  const [syncErrorReason, setSyncErrorReason] = useState<string | undefined>(undefined);
  // Текст помилки — на відміну від бейджа (постійний, поки не полагодили) —
  // показується лише 60с з моменту появи проблеми, щоб не висіти тижнями.
  // Бейдж лишається головним індикатором стану.
  const [showErrorBanner, setShowErrorBanner] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [keyPreview, setKeyPreview] = useState<string | null>(null);
  const [showLockedToast, setShowLockedToast] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncErrorMessage = (reason?: string) => {
    const messages = language === "UA"
      ? {
          app_not_installed: "Застосунок RIVANT не встановлено в Shopify.",
          // ФІКС (аудит 03.09.2026): раніше цей текст був жорстко зашитий під
          // Shopify ("Перевірте... Shopify"), хоча access_denied повертають
          // ще й sync-stripe-core.mjs, і тепер paypal-sync.mjs — юзер Stripe/
          // PayPal бачив би "перевірте токен Shopify", що просто неправда.
          access_denied: `Перевірте ключі доступу ${displayName} у налаштуваннях інтеграції.`,
          missing_scope: `У застосунку ${displayName} не увімкнено потрібний доступ/дозвіл.`,
          rate_limited: `${displayName} тимчасово обмежив кількість запитів — спробуємо ще раз автоматично.`,
          store_not_found: "Перевірте адресу магазину Shopify.",
          // ФІКС (аудит 30.08.2026, знахідка №1): sync-stripe-core.mjs тепер
          // призупиняє синк і пише саме цю причину для тестових (rk_test_)
          // ключів Stripe, підключених до фіксу в connect-stripe/route.js.
          test_key_not_synced: "Підключено тестовий ключ Stripe (rk_test_...) — синхронізація призупинена. Підключіть бойовий ключ (rk_live_...).",
          connection_failed: `Не вдалося синхронізувати ${displayName}. Перевірте доступ.`,
        }
      : language === "DE"
      ? {
          app_not_installed: "Die RIVANT-App ist nicht in Shopify installiert.",
          access_denied: `Prüfen Sie die ${displayName}-Zugangsdaten in den Integrationseinstellungen.`,
          missing_scope: `Die ${displayName}-App hat nicht den nötigen Zugriff/Berechtigung aktiviert.`,
          rate_limited: `${displayName} hat Anfragen vorübergehend limitiert — wir versuchen es automatisch erneut.`,
          store_not_found: "Prüfen Sie die Shopify-Shop-Adresse.",
          test_key_not_synced: "Ein Stripe-Testschlüssel (rk_test_...) ist verbunden — Synchronisierung pausiert. Verbinden Sie einen Live-Schlüssel (rk_live_...).",
          connection_failed: `${displayName} konnte nicht synchronisiert werden. Prüfen Sie den Zugriff.`,
        }
      : {
          app_not_installed: "The RIVANT app is not installed in Shopify.",
          access_denied: `Check the ${displayName} access keys in the integration settings.`,
          missing_scope: `The ${displayName} app doesn't have the required access/scope enabled.`,
          rate_limited: `${displayName} temporarily rate-limited requests — we'll retry automatically.`,
          store_not_found: "Check the Shopify store address.",
          test_key_not_synced: "A Stripe test key (rk_test_...) is connected — sync paused. Connect a live key (rk_live_...).",
          connection_failed: `Couldn't sync ${displayName}. Check the access.`,
        };
    return messages[reason as keyof typeof messages] || messages.connection_failed;
  };

  const loadStatus = async () => {
    if (!email) return;
    try {
      const response = await fetch(`/api/integrations-status?email=${encodeURIComponent(email)}`, { cache: "no-store" });
      const data = await response.json();
      const row = (data.integrations || []).find((i: any) => i.provider === provider);
      if (row?.sync_error) {
        // Ключі валідні і колись підключення пройшло, але останній синк
        // (кроном чи вручну) впав — показуємо це одразу, а не мовчки
        // тримаємо зелений бейдж "Підключено".
        setStatus("connected");
        setErrorMsg("");
        setHasSyncError(true);
        setSyncErrorReason(row.config?.sync_error_reason);
        setLastSynced(row.last_synced_at);
        setKeyPreview(row.key_preview);
        if (showRevenueModeCheckbox) {
          setRevenueModeAdd(row.config?.revenue_mode === "add");
        }
      } else if (row?.connected) {
        setStatus("connected");
        setErrorMsg("");
        setHasSyncError(false);
        setLastSynced(row.last_synced_at);
        setKeyPreview(row.key_preview);
        if (fields.length && row.config) {
          const prefill: Record<string, string> = {};
          for (const f of fields) {
            if (row.config[f.key]) prefill[f.key] = row.config[f.key];
          }
          setExtraValues(prefill);
        }
        if (showRevenueModeCheckbox) {
          setRevenueModeAdd(row.config?.revenue_mode === "add");
        }
      } else {
        setStatus("idle");
        setHasSyncError(false);
      }
    } catch {
      setStatus("idle");
    }
  };

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, provider, refreshToken]);

  // Банер з описом живе лише 60с з моменту, коли hasSyncError стає true —
  // це рахується і для першого рендера картки з уже активною помилкою.
  // Бейдж на кнопці лишається без обмеження за часом, поки статус не
  // зміниться на успішний.
  useEffect(() => {
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    if (hasSyncError) {
      setShowErrorBanner(true);
      bannerTimerRef.current = setTimeout(() => setShowErrorBanner(false), 60_000);
    } else {
      setShowErrorBanner(false);
    }
    return () => {
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    };
  }, [hasSyncError]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    };
  }, []);

  // ФІКС: раніше тут був захардкоджений `planTier === "starter" ? "plan"`,
  // тобто Starter завжди трактувався як "інтеграція недоступна на цьому
  // тарифі" — навіть коли бекенд (integrations-select/route.js) вже давно
  // дозволяє Starter обрати 1 слот (Stripe АБО Shopify). Через це вже
  // підключений і синкающийся Shopify показував червоний замок "доступно
  // на Growth", а якщо синк ламався — юзер не міг сам ввести нові дані
  // (кнопка "Підключити"/"Оновити підключення" перехоплювалась як locked
  // ще ДО запиту на бекенд). Тепер логіка слотів одна на весь фронтенд і
  // бекенд (lib/plan-slots.js) — Starter дає 1 слот, Growth 2, Scale/Trial
  // безліміт, і карта блокується лише тоді, коли вільних слотів реально
  // немає (selectedProviders.length >= maxSlots) і зайнятий слот — не цей
  // provider.
  const lockReason = getIntegrationLockReason({
    isExpiredTrial,
    planTier,
    selectedProviders,
    provider,
  }) as LockReason;

  const maxSlots = getMaxSlots(planTier);
  // ФІКС: та сама причина, що й у stripe-connect-card.tsx — lockReason
  // спирається лише на subscriptions.integrations_selected, і якщо провайдер
  // реально підключений (row.connected === true з /api/integrations-status),
  // а вибір слоту з якоїсь причини не зафіксовано/загублено, картка
  // показувала замок поверх робочої інтеграції. Реальний статус
  // "connected" тепер має пріоритет над записом вибору слоту.
  const locked = lockReason !== null && status !== "connected";

  const triggerLockedToast = () => {
    setShowLockedToast(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setShowLockedToast(false), 6000);
  };

  const handleConnect = async () => {
    if (locked) {
      triggerLockedToast();
      return;
    }
    if (!apiKey.trim()) return;
    for (const f of fields) {
      if (!extraValues[f.key]?.trim()) {
        setStatus("error");
        setErrorMsg(`${f.label} is required`);
        return;
      }
    }
    setStatus("loading");
    setErrorMsg("");
    try {
      const res = await fetch("/api/connect-integration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          provider,
          apiKey: apiKey.trim(),
          config: {
            ...Object.fromEntries(fields.map((f) => [f.key, extraValues[f.key]?.trim() || ""])),
            ...(showRevenueModeCheckbox ? { revenue_mode: revenueModeAdd ? "add" : "replace" } : {}),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setErrorMsg(data.error || "Connection failed");
        return;
      }

      // Тариф з обмеженою кількістю слотів (Starter — 1, Growth — 2) — якщо
      // ще лишався вільний слот і його ще не зайняв саме цей provider,
      // одразу фіксуємо вибір. ФІКС: раніше тут перевірялось лише
      // `selectedProviders.length === 0` і відправлявся масив з ОДНИМ
      // provider — тобто підключення другого провайдера на Growth (2
      // слоти) перезаписувало вибір і ГУБИЛО перший слот замість того, щоб
      // додатись до нього. Тепер мерджимо з уже обраними і шлемо повний
      // масив; повідомляємо батьківський компонент саме цим повним
      // масивом (onSelected), а не одним provider.
      if (
        maxSlots !== undefined &&
        maxSlots !== null &&
        selectedProviders.length < maxSlots &&
        !selectedProviders.includes(provider)
      ) {
        const merged = [...selectedProviders, provider];
        try {
          const selRes = await fetch("/api/integrations-select", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, providers: merged }),
          });
          if (selRes.ok) onSelected?.(merged);
        } catch (e) {
          console.error("Failed to lock integration selection", e);
        }
      }

      setApiKey("");
      const syncResponse = await fetch("/api/sync-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, provider }),
      });
      if (!syncResponse.ok) {
        // Не показуємо тимчасовий тост окремо від бейджа — підтягуємо
        // актуальний статус з БД, щоб бейдж і банер одразу відображали
        // реальну помилку синхронізації (hasSyncError), а не "Підключено".
        await loadStatus();
        return;
      }
      const syncResult = await syncResponse.json().catch(() => ({}));
      if (syncResult.failedProviders?.includes(provider)) {
        await loadStatus();
        return;
      }
      await loadStatus();
    } catch {
      setStatus("error");
      setErrorMsg("Network error");
    }
  };

  const handleToggleRevenueMode = async () => {
    const nextMode = revenueModeAdd ? "replace" : "add";
    setRevenueModeSaving(true);
    try {
      const res = await fetch("/api/integration-revenue-mode", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, provider, revenueMode: nextMode }),
      });
      if (res.ok) setRevenueModeAdd(nextMode === "add");
    } catch (e) {
      console.error("Failed to update revenue_mode", e);
    } finally {
      setRevenueModeSaving(false);
    }
  };

  const handleOAuthConnect = () => {
    if (locked) {
      triggerLockedToast();
      return;
    }
    if (!oauthStartHref) return;
    window.location.href = oauthStartHref;
  };

  const handleDisconnect = async () => {
    if (isExpiredTrial) {
      triggerLockedToast();
      return;
    }
    await fetch("/api/connect-integration", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, provider }),
    });
    setStatus("idle");
    setLastSynced(null);
    setKeyPreview(null);
    // Навмисно НЕ звільняємо selectedProviders тут — вибір лишається
    // зафіксованим до кінця billing-періоду навіть після відключення.
  };

  const texts = {
    connectDesc:
      language === "UA"
        ? `Підключіть ${displayName}, щоб отримувати реальні дані`
        : language === "DE"
        ? `Verbinden Sie ${displayName}, um echte Daten abzurufen`
        : `Connect ${displayName} to pull real data`,
    connectedWaiting:
      language === "UA" ? "Підключено, очікуємо першу синхронізацію" : language === "DE" ? "Verbunden, wartet auf erste Synchronisierung" : "Connected, waiting for first sync",
    connectedError:
      language === "UA" ? "Підключено, але останній синк не пройшов" : language === "DE" ? "Verbunden, aber die letzte Synchronisierung ist fehlgeschlagen" : "Connected, but the last sync failed",
    lastSyncedLabel: language === "UA" ? "Остання синхронізація" : language === "DE" ? "Letzte Synchronisierung" : "Last synced",
    connected: language === "UA" ? "Підключено" : language === "DE" ? "Verbunden" : "Connected",
    connectBtn: language === "UA" ? `Підключити ${displayName}` : language === "DE" ? `${displayName} verbinden` : `Connect ${displayName}`,
    reconnectBtn: language === "UA" ? "Оновити підключення" : language === "DE" ? "Verbindung aktualisieren" : "Update connection",
    reconnectHint:
      language === "UA"
        ? "Введіть оновлені дані нижче й підключіть ще раз — не потрібно спершу відключати."
        : language === "DE"
        ? "Geben Sie unten aktualisierte Daten ein und verbinden Sie erneut — kein vorheriges Trennen nötig."
        : "Enter updated details below and connect again — no need to disconnect first.",
    disconnectBtn: language === "UA" ? "Відключити" : language === "DE" ? "Trennen" : "Disconnect",
    syncErrorBadge: language === "UA" ? "Помилка синхронізації" : language === "DE" ? "Sync-Fehler" : "Sync error",
    syncNowBtn: language === "UA" ? "Синхронізувати зараз" : language === "DE" ? "Jetzt synchronisieren" : "Sync now",
    connecting: language === "UA" ? "Підключення..." : language === "DE" ? "Verbinde..." : "Connecting...",
    revenueModeAddLabel:
      language === "UA"
        ? "Це окремий потік грошей (не через Stripe) — додавати виручку Shopify зверху, а не замінювати нею Stripe"
        : language === "DE"
        ? "Das ist ein separater Zahlungsfluss (nicht über Stripe) — Shopify-Umsatz zum Stripe-Umsatz addieren statt ihn zu ersetzen"
        : "This is a separate money flow (not via Stripe) — add Shopify revenue on top instead of replacing Stripe's",
    revenueModeCurrentReplace:
      language === "UA"
        ? "Дохід: Shopify замінює Stripe (той самий Checkout)"
        : language === "DE"
        ? "Umsatz: Shopify ersetzt Stripe (derselbe Checkout)"
        : "Revenue: Shopify replaces Stripe (same checkout)",
    revenueModeCurrentAdd:
      language === "UA"
        ? "Дохід: Shopify додається зверху Stripe (окремий потік)"
        : language === "DE"
        ? "Umsatz: Shopify wird zu Stripe addiert (separater Fluss)"
        : "Revenue: Shopify is added on top of Stripe (separate flow)",
    revenueModeSwitchToAdd: language === "UA" ? "Це окремий потік — додавати" : language === "DE" ? "Separater Fluss — addieren" : "Separate flow — add instead",
    revenueModeSwitchToReplace: language === "UA" ? "Це той самий Stripe — замінювати" : language === "DE" ? "Derselbe Stripe — ersetzen" : "Same as Stripe — replace instead",
    revenueModeSaving: language === "UA" ? "Зберігаємо..." : language === "DE" ? "Speichere..." : "Saving...",
  };

  const planLabel = planTier ? planTier.charAt(0).toUpperCase() + planTier.slice(1) : "";
  const maxSlotsLabel =
    maxSlots === 1
      ? language === "UA"
        ? "1 інтеграцію"
        : language === "DE"
        ? "1 Integration"
        : "1 integration"
      : language === "UA"
      ? `${maxSlots} інтеграції`
      : language === "DE"
      ? `${maxSlots} Integrationen`
      : `${maxSlots} integrations`;

  const lockedTexts: Record<Exclude<LockReason, null>, { title: string; body: string; cta: string }> = {
    expired: {
      title: language === "UA" ? "Тариф не активний" : language === "DE" ? "Kein aktiver Tarif" : "No active plan",
      body:
        language === "UA"
          ? "Щоб підключити інтеграцію, потрібно оформити тариф."
          : language === "DE"
          ? "Um eine Integration zu verbinden, benötigen Sie einen aktiven Tarif."
          : "You need an active plan to connect this integration.",
      cta: language === "UA" ? "Переглянути тарифи" : language === "DE" ? "Tarife ansehen" : "View plans",
    },
    plan: {
      title: language === "UA" ? "Потрібен активний тариф" : language === "DE" ? "Aktiver Tarif erforderlich" : "Active plan required",
      body:
        language === "UA"
          ? `Щоб підключити ${displayName}, потрібен активний тариф з вільним слотом інтеграції.`
          : language === "DE"
          ? `Um ${displayName} zu verbinden, benötigen Sie einen aktiven Tarif mit einem freien Integrations-Slot.`
          : `You need an active plan with a free integration slot to connect ${displayName}.`,
      cta: language === "UA" ? "Переглянути тарифи" : language === "DE" ? "Tarife ansehen" : "View plans",
    },
    selection: {
      title:
        language === "UA"
          ? "Вибір зафіксовано"
          : language === "DE"
          ? "Auswahl fixiert"
          : "Selection locked",
      body:
        language === "UA"
          ? `На тарифі ${planLabel} доступно ${maxSlotsLabel}. Зараз зайнято: ${selectedProviders.join(", ") || "інша інтеграція"} — щоб підключити ${displayName}, відключіть одну з них або перейдіть на тариф з більшою кількістю слотів.`
          : language === "DE"
          ? `Der ${planLabel}-Tarif bietet ${maxSlotsLabel}. Aktuell belegt: ${selectedProviders.join(", ") || "eine andere Integration"} — trennen Sie eine davon oder upgraden Sie, um ${displayName} zu verbinden.`
          : `The ${planLabel} plan gives you ${maxSlotsLabel}. Currently used by: ${selectedProviders.join(", ") || "another integration"} — disconnect one of them or upgrade to connect ${displayName}.`,
      cta: language === "UA" ? "Переглянути тарифи" : language === "DE" ? "Tarife ansehen" : "View plans",
    },
  };

  const lockedOkText = language === "UA" ? "Гаразд" : language === "DE" ? "OK" : "OK";

  if (status === "checking") {
    return (
      <div className="bg-gray-900/30 rounded-xl p-5 border border-gray-800">
        <div className="flex items-center justify-between mb-1">
          <h4 className="font-semibold text-white">{displayName}</h4>
        </div>
        <div className="h-4 w-40 bg-gray-800 rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="bg-gray-900/30 rounded-xl p-5 border border-gray-800 relative">
      {locked && (
        <div className="absolute top-4 right-4 text-red-400" title={lockedTexts[lockReason!].title}>
          <Lock className="w-4 h-4" />
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h4 className="font-semibold text-white">{displayName}</h4>
          <p className="text-xs text-gray-500">
            {status === "connected"
              ? hasSyncError
                ? `${texts.connectedError}${fields[0] && extraValues[fields[0].key] ? ` · ${extraValues[fields[0].key]}` : ""}`
                : lastSynced
                ? `${texts.lastSyncedLabel}: ${new Date(lastSynced).toLocaleString()}${fields[0] && extraValues[fields[0].key] ? ` · ${extraValues[fields[0].key]}` : ""}`
                : `${texts.connectedWaiting}${fields[0] && extraValues[fields[0].key] ? ` · ${extraValues[fields[0].key]}` : ""}`
              : texts.connectDesc}
          </p>
        </div>
        {status === "connected" && (
          <div className="flex flex-wrap items-center gap-2 min-w-0 w-full sm:w-auto">
            {hasSyncError ? (
              <span className="text-xs px-2 py-1 rounded-full font-semibold bg-red-500/20 text-red-400 flex items-center gap-1 font-mono min-w-0 max-w-full">
                <AlertCircle className="w-3 h-3 shrink-0" />
                <span className="truncate">{texts.syncErrorBadge}{keyPreview ? ` · ${keyPreview}` : ""}</span>
              </span>
            ) : (
              <span className="text-xs px-2 py-1 rounded-full font-semibold bg-green-500/20 text-green-400 flex items-center gap-1 font-mono min-w-0 max-w-full">
                <CheckCircle className="w-3 h-3 shrink-0" />
                <span className="truncate">{texts.connected}{keyPreview ? ` · ${keyPreview}` : ""}</span>
              </span>
            )}
            <Button size="sm" variant="outline" className="text-red-400 border-red-400/30 hover:bg-red-500/10 shrink-0" onClick={handleDisconnect}>
              {texts.disconnectBtn}
            </Button>
          </div>
        )}
      </div>

      {(status !== "connected" || hasSyncError) && oauthStartHref && (
        <div className="space-y-2">
          {hasSyncError && <p className="text-xs text-gray-400">{texts.reconnectHint}</p>}
          <p className="text-xs text-gray-500">{hint}</p>
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={handleOAuthConnect}>
            {hasSyncError ? texts.reconnectBtn : oauthButtonLabel || texts.connectBtn}
          </Button>

          {showLockedToast && lockReason && (
            <div className="mt-2 bg-gray-950 border border-red-500/30 rounded-lg p-3 flex flex-col gap-2 animate-in fade-in slide-in-from-top-1">
              <div className="flex items-start gap-2">
                <Lock className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-white">{lockedTexts[lockReason].title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{lockedTexts[lockReason].body}</p>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" className="text-gray-400 hover:text-white" onClick={() => setShowLockedToast(false)}>
                  {lockedOkText}
                </Button>
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => onLockedClick?.()}>
                  {lockedTexts[lockReason].cta}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {(status !== "connected" || hasSyncError) && !oauthStartHref && (
        <div className="space-y-2">
          {hasSyncError && <p className="text-xs text-gray-400">{texts.reconnectHint}</p>}
          {fields.map((f) => (
            <div key={f.key}>
              <input
                type="text"
                value={extraValues[f.key] || ""}
                onChange={(e) => setExtraValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                autoComplete="off"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <p className="text-xs text-gray-500 mt-1">{f.label}</p>
            </div>
          ))}
          <input
            type="text"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-lpignore="true"
            data-1p-ignore="true"
            name={`rivant-${provider}-key-field`}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <p className="text-xs text-gray-500">{hint}</p>
          {showRevenueModeCheckbox && (
            <label className="flex items-start gap-2 text-xs text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={revenueModeAdd}
                onChange={(e) => setRevenueModeAdd(e.target.checked)}
                className="mt-0.5"
              />
              <span>{texts.revenueModeAddLabel}</span>
            </label>
          )}
          {status === "error" && (
            <p className="text-xs text-red-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {errorMsg}
            </p>
          )}
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={handleConnect} disabled={status === "loading"}>
            {status === "loading" ? texts.connecting : hasSyncError ? texts.reconnectBtn : texts.connectBtn}
          </Button>

          {showLockedToast && lockReason && (
            <div className="mt-2 bg-gray-950 border border-red-500/30 rounded-lg p-3 flex flex-col gap-2 animate-in fade-in slide-in-from-top-1">
              <div className="flex items-start gap-2">
                <Lock className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-white">{lockedTexts[lockReason].title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{lockedTexts[lockReason].body}</p>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" className="text-gray-400 hover:text-white" onClick={() => setShowLockedToast(false)}>
                  {lockedOkText}
                </Button>
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => onLockedClick?.()}>
                  {lockedTexts[lockReason].cta}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {status === "connected" && showRevenueModeCheckbox && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2">
          <p className="text-xs text-gray-400">
            {revenueModeAdd ? texts.revenueModeCurrentAdd : texts.revenueModeCurrentReplace}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7 shrink-0"
            onClick={handleToggleRevenueMode}
            disabled={revenueModeSaving}
          >
            {revenueModeSaving ? texts.revenueModeSaving : revenueModeAdd ? texts.revenueModeSwitchToReplace : texts.revenueModeSwitchToAdd}
          </Button>
        </div>
      )}

      {/* Банер — під усіма рядками картки, як і просили. Бейдж вище вже
          показує стан постійно; цей текст — лише пояснення на 60с, а сам
          факт помилки додатково падає в Ризики (див. lib/alerts.mjs /
          sync_failure_* — це вже робить бекенд при кожному падінні синку). */}
      {status === "connected" && hasSyncError && showErrorBanner && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <p>{syncErrorMessage(syncErrorReason)}</p>
            <p className="mt-1 text-red-200/70">
              {language === "UA"
                ? "Деталі та наступні спроби — на вкладці «Ризики»."
                : language === "DE"
                ? "Details und weitere Versuche — im Tab „Risiken“."
                : "Details and further attempts — on the Risks tab."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}