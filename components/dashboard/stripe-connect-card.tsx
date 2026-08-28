"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle, AlertCircle, Lock } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { getMaxSlots, getIntegrationLockReason } from "@/lib/plan-slots";

type LockReason = "expired" | "plan" | "selection" | null;

interface Props {
  email: string;
  isExpiredTrial?: boolean;
  // ФІКС: раніше Stripe взагалі не брав участі у системі слотів
  // (integrations_selected) — картка була завжди "розблокована" незалежно
  // від тарифу чи вибору, зробленого на Shopify/Meta Ads/Google Ads.
  // Бекенд (/api/connect-stripe) вже давно вимагає, щоб на Starter/Growth
  // "stripe" був у integrations_selected — а якщо Starter-клієнт обрав
  // єдиним слотом Shopify, Stripe реально підключити було не можна, але
  // картка мовчала про це до першого кліку "Підключити" (і то показувала
  // сирий текст помилки з бекенду замість проактивного замка, як в інших
  // картках). Тепер Stripe отримує ті самі planTier/selectedProviders/
  // onSelected, що й IntegrationConnectCard, і рахує lockReason за тією ж
  // спільною логікою (lib/plan-slots.js).
  planTier?: string | null;
  selectedProviders?: string[];
  onLockedClick?: () => void;
  onSelected?: (providers: string[]) => void;
  /**
   * Forces the "connected" visual with demo data, regardless of the real
   * Stripe status fetched from /api/business-status. Used only by the
   * onboarding tour's "See a live integration" step (see page.tsx /
   * onboarding-tour.tsx) — never touches the real API and the Disconnect
   * button is disabled while this is on, so a tour click can't actually
   * disconnect the user's real Stripe key.
   */
  demoConnected?: boolean;
}

export function StripeConnectCard({
  email,
  isExpiredTrial = false,
  planTier = null,
  selectedProviders = [],
  onLockedClick,
  onSelected,
  demoConnected = false,
}: Props) {
  const { language } = useLanguage();
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<"checking" | "idle" | "loading" | "connected" | "error">("checking");
  const [errorMsg, setErrorMsg] = useState("");
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [keyPreview, setKeyPreview] = useState<string | null>(null);
  const [showLockedToast, setShowLockedToast] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadStatus = () => {
    if (!email) return;
    fetch(`/api/business-status?email=${encodeURIComponent(email)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.business?.stripe_connected) {
          setKeyPreview(d.business.key_preview);
          setStatus("connected");
          setLastSynced(d.business.last_synced_at);
        } else {
          setStatus("idle");
        }
      })
      .catch(() => setStatus("idle"));
  };

  useEffect(() => {
    loadStatus();
  }, [email]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const triggerLockedToast = () => {
    setShowLockedToast(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setShowLockedToast(false), 6000);
  };

  // Та сама спільна логіка слотів, що й у IntegrationConnectCard (Shopify/
  // Meta Ads/Google Ads) — див. lib/plan-slots.js. Раніше Stripe в ній
  // взагалі не брав участі.
  const lockReason = getIntegrationLockReason({
    isExpiredTrial,
    planTier,
    selectedProviders,
    provider: "stripe",
  }) as LockReason;
  const maxSlots = getMaxSlots(planTier);
  const locked = lockReason !== null;

  // Ничего из реального состояния (status/keyPreview/lastSynced) не
  // трогаем и не перезаписываем — просто подменяем то, что рендерится,
  // пока идёт демо-шаг тура. Как только тур уходит с этого шага
  // (demoConnected снова false), карточка мгновенно возвращается к
  // настоящему статусу, который всё это время спокойно лежал в стейте.
  const displayStatus = demoConnected ? "connected" : status;
  const displayKeyPreview = demoConnected ? "rk_live_••••4242" : keyPreview;
  const displayLastSynced = demoConnected ? new Date(Date.now() - 3 * 60 * 1000).toISOString() : lastSynced;

  const handleConnect = async () => {
    if (locked) {
      triggerLockedToast();
      return;
    }
    if (!apiKey.trim()) return;
    setStatus("loading");
    setErrorMsg("");
    try {
      const res = await fetch("/api/connect-stripe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, apiKey: apiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setErrorMsg(data.error || "Connection failed");
        return;
      }

      // Той самий механізм фіксації слоту, що й у IntegrationConnectCard —
      // якщо на цьому тарифі ще лишався вільний слот, одразу зберігаємо
      // "stripe" в integrations_selected, мерджачи з уже обраним (а не
      // перезаписуючи його), щоб не загубити паралельно обраний Shopify/
      // Meta Ads/Google Ads на Growth (2 слоти).
      if (
        maxSlots !== undefined &&
        maxSlots !== null &&
        selectedProviders.length < maxSlots &&
        !selectedProviders.includes("stripe")
      ) {
        const merged = [...selectedProviders, "stripe"];
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
      loadStatus();
      // Не ждём часовой cron — сразу дёргаем синк для этого бизнеса.
      // Пусть работает в фоне; если упадёт — данные всё равно подтянутся
      // на следующем плановом прогоне, поэтому не блокируем UI на этом await.
      fetch("/api/sync-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, provider: "stripe" }),
      }).catch((e) => console.error("sync-now failed", e));
    } catch {
      setStatus("error");
      setErrorMsg("Network error");
    }
  };

  const handleDisconnect = async () => {
    // Навмисно перевіряємо лише isExpiredTrial, а не повний locked — так
    // само, як у IntegrationConnectCard: відключення вже підключеної
    // інтеграції має лишатись доступним навіть якщо (гіпотетично) слот
    // зайнятий, інакше клієнт не зможе звільнити його сам. selectedProviders
    // свідомо НЕ звільняється тут — вибір лишається зафіксованим до кінця
    // billing-періоду навіть після відключення.
    if (isExpiredTrial) {
      triggerLockedToast();
      return;
    }
    await fetch("/api/stripe-disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setStatus("idle");
    setLastSynced(null);
    setKeyPreview(null);
  };

  const texts = {
    connectDesc:
      language === "UA"
        ? "Підключіть Stripe, щоб отримувати реальні дані про виручку"
        : language === "DE"
        ? "Verbinden Sie Stripe, um echte Umsatzdaten abzurufen"
        : "Connect your Stripe account to pull real revenue data",
    connectedWaiting:
      language === "UA" ? "Підключено, очікуємо першу синхронізацію" : language === "DE" ? "Verbunden, wartet auf erste Synchronisierung" : "Connected, waiting for first sync",
    lastSynced: language === "UA" ? "Остання синхронізація" : language === "DE" ? "Letzte Synchronisierung" : "Last synced",
    connected: language === "UA" ? "Підключено" : language === "DE" ? "Verbunden" : "Connected",
    hint:
      language === "UA"
        ? "Створіть restricted key з доступом лише на читання в Stripe Dashboard → Developers → API keys → Create restricted key."
        : language === "DE"
        ? "Erstellen Sie einen restricted key mit Lesezugriff in Stripe Dashboard → Developers → API keys → Create restricted key."
        : "Create a restricted key with read-only access in Stripe Dashboard → Developers → API keys → Create restricted key.",
    connectBtn: language === "UA" ? "Підключити Stripe" : language === "DE" ? "Stripe verbinden" : "Connect Stripe",
    disconnectBtn: language === "UA" ? "Відключити" : language === "DE" ? "Trennen" : "Disconnect",
    connecting: language === "UA" ? "Підключення..." : language === "DE" ? "Verbinde..." : "Connecting...",
    placeholder: "rk_test_... / rk_live_...",
    lockedTitle: language === "UA" ? "Тариф не активний" : language === "DE" ? "Kein aktiver Tarif" : "No active plan",
    lockedOk: language === "UA" ? "Гаразд" : language === "DE" ? "OK" : "OK",
    lockedViewPlans: language === "UA" ? "Переглянути тарифи" : language === "DE" ? "Tarife ansehen" : "View plans",
    demoDisconnectHint:
      language === "UA"
        ? "Це демонстраційний вигляд для туру — відключення тут недоступне"
        : language === "DE"
        ? "Dies ist die Demo-Ansicht der Tour — Trennen ist hier nicht möglich"
        : "This is the tour's demo view — disconnecting isn't available here",
  };

  // Динамічний текст замка залежно від причини (та сама схема, що й у
  // IntegrationConnectCard) — раніше тут завжди був один статичний текст
  // "Тариф не активний" незалежно від того, чи реально немає підписки, чи
  // просто зайняті слоти.
  const planLabel = planTier ? planTier.charAt(0).toUpperCase() + planTier.slice(1) : "";
  const lockedTitle =
    lockReason === "selection"
      ? language === "UA"
        ? "Вибір зафіксовано"
        : language === "DE"
        ? "Auswahl fixiert"
        : "Selection locked"
      : texts.lockedTitle;
  const lockedBody =
    lockReason === "selection"
      ? language === "UA"
        ? `На тарифі ${planLabel} зараз зайнято: ${selectedProviders.join(", ") || "інша інтеграція"} — щоб підключити Stripe, відключіть одну з них або перейдіть на тариф з більшою кількістю слотів.`
        : language === "DE"
        ? `Im ${planLabel}-Tarif ist derzeit belegt: ${selectedProviders.join(", ") || "eine andere Integration"} — trennen Sie eine davon oder upgraden Sie, um Stripe zu verbinden.`
        : `On the ${planLabel} plan, currently used by: ${selectedProviders.join(", ") || "another integration"} — disconnect one of them or upgrade to connect Stripe.`
      : language === "UA"
      ? "Щоб підключити інтеграцію, потрібно оформити тариф."
      : language === "DE"
      ? "Um eine Integration zu verbinden, benötigen Sie einen aktiven Tarif."
      : "You need an active plan to connect this integration.";

  if (displayStatus === "checking") {
    return (
      <div className="bg-gray-900/30 rounded-xl p-5 border border-gray-800">
        <div className="flex items-center justify-between mb-1">
          <h4 className="font-semibold text-white">Stripe</h4>
        </div>
        <div className="h-4 w-40 bg-gray-800 rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="bg-gray-900/30 rounded-xl p-5 border border-gray-800 relative">
      {locked && (
        <div className="absolute top-4 right-4 text-red-400" title={lockedTitle}>
          <Lock className="w-4 h-4" />
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h4 className="font-semibold text-white">Stripe</h4>
          <p className="text-xs text-gray-500">
            {displayStatus === "connected"
              ? displayLastSynced
                ? `${texts.lastSynced}: ${new Date(displayLastSynced).toLocaleString()}`
                : texts.connectedWaiting
              : texts.connectDesc}
          </p>
        </div>
        {displayStatus === "connected" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs px-2 py-1 rounded-full font-semibold bg-green-500/20 text-green-400 flex items-center gap-1 font-mono whitespace-nowrap">
              <CheckCircle className="w-3 h-3 shrink-0" /> {texts.connected}{displayKeyPreview ? ` · ${displayKeyPreview}` : ""}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="text-red-400 border-red-400/30 hover:bg-red-500/10 shrink-0 disabled:opacity-40 disabled:pointer-events-none"
              onClick={handleDisconnect}
              disabled={demoConnected}
              title={demoConnected ? texts.demoDisconnectHint : undefined}
            >
              {texts.disconnectBtn}
            </Button>
          </div>
        )}
      </div>

      {displayStatus !== "connected" && (
        <div className="space-y-2">
          <input
            type="text"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={texts.placeholder}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-lpignore="true"
            data-1p-ignore="true"
            name="rivant-stripe-key-field"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <p className="text-xs text-gray-500">{texts.hint}</p>
          {status === "error" && (
            <p className="text-xs text-red-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {errorMsg}
            </p>
          )}
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={handleConnect} disabled={status === "loading"}>
            {status === "loading" ? texts.connecting : texts.connectBtn}
          </Button>

          {showLockedToast && (
            <div className="mt-2 bg-gray-950 border border-red-500/30 rounded-lg p-3 flex flex-col gap-2 animate-in fade-in slide-in-from-top-1">
              <div className="flex items-start gap-2">
                <Lock className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-white">{lockedTitle}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{lockedBody}</p>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" className="text-gray-400 hover:text-white" onClick={() => setShowLockedToast(false)}>
                  {texts.lockedOk}
                </Button>
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => onLockedClick?.()}>
                  {texts.lockedViewPlans}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}