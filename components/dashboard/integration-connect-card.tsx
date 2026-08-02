"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle, AlertCircle, Lock } from "lucide-react";
import { useLanguage } from "@/lib/translations";

type LockReason = "expired" | "plan" | "selection" | null;

interface Props {
  email: string;
  provider: string;
  displayName: string;
  placeholder: string;
  hint: string;
  isExpiredTrial?: boolean;
  // "trial" даёт доступ як Growth (одна додаткова інтеграція), "growth" — одна,
  // "scale" — без обмежень, "starter"/null — додаткові інтеграції недоступні.
  planTier?: string | null;
  // Поточний зафіксований вибір на billing-період (з subscriptions.integrations_selected).
  selectedProviders?: string[];
  onLockedClick?: () => void;
  // Викликається після успішного підключення на Growth/Trial — щоб батьківський
  // компонент одразу оновив selectedProviders і заблокував інші картки без релоаду.
  onSelected?: (provider: string) => void;
  // Деяким провайдерам (Shopify — домен магазину, Meta Ads — Ad Account ID) мало
  // самого ключа. Якщо задано — рендериться друге поле, обов'язкове для підключення.
  extraField?: { key: string; label: string; placeholder: string };
  // Google Ads потребує одразу кількох полів (Customer ID, OAuth Client ID/Secret,
  // Developer Token) на додачу до refresh token в основному полі — використовуємо
  // це замість extraField, коли треба більше одного додаткового поля.
  extraFields?: { key: string; label: string; placeholder: string }[];
}

// Trial навмисно НЕ в цьому списку: під час трайлу доступ повний, як на Scale,
// щоб людина побачила всю цінність продукту до оплати. Обмеження на 1 інтеграцію
// діє тільки для платного тарифу Growth.
const SINGLE_PICK_TIERS = ["growth"];

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
}: Props) {
  const { language } = useLanguage();
  // Нормалізуємо обидва варіанти (одне поле / кілька полів) в один масив,
  // щоб решта компонента не знала про різницю.
  const fields = extraFields ?? (extraField ? [extraField] : []);
  const [apiKey, setApiKey] = useState("");
  const [extraValues, setExtraValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"checking" | "idle" | "loading" | "connected" | "error">("checking");
  const [errorMsg, setErrorMsg] = useState("");
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [keyPreview, setKeyPreview] = useState<string | null>(null);
  const [showLockedToast, setShowLockedToast] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadStatus = () => {
    if (!email) return;
    fetch(`/api/integrations-status?email=${encodeURIComponent(email)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const row = (d.integrations || []).find((i: any) => i.provider === provider);
        if (row?.connected) {
          setStatus("connected");
          setLastSynced(row.last_synced_at);
          setKeyPreview(row.key_preview);
          if (fields.length && row.config) {
            const prefill: Record<string, string> = {};
            for (const f of fields) {
              if (row.config[f.key]) prefill[f.key] = row.config[f.key];
            }
            setExtraValues(prefill);
          }
        } else {
          setStatus("idle");
        }
      })
      .catch(() => setStatus("idle"));
  };

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, provider]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Визначаємо причину блокування, за пріоритетом: trial/план закінчився >
  // немає доступу до додаткових інтеграцій на цьому тарифі > вибір уже
  // зафіксований на іншому провайдері цього billing-періоду.
  const lockReason: LockReason = isExpiredTrial
    ? "expired"
    : !planTier || planTier === "starter"
    ? "plan"
    : SINGLE_PICK_TIERS.includes(planTier) && selectedProviders.length > 0 && !selectedProviders.includes(provider)
    ? "selection"
    : null;

  const locked = lockReason !== null;

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
          config: Object.fromEntries(fields.map((f) => [f.key, extraValues[f.key]?.trim() || ""])),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setErrorMsg(data.error || "Connection failed");
        return;
      }

      // Тариф з обмеженням в 1 додаткову інтеграцію — одразу фіксуємо вибір.
      if (planTier && SINGLE_PICK_TIERS.includes(planTier) && selectedProviders.length === 0) {
        try {
          const selRes = await fetch("/api/integrations-select", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, providers: [provider] }),
          });
          if (selRes.ok) onSelected?.(provider);
        } catch (e) {
          console.error("Failed to lock integration selection", e);
        }
      }

      setApiKey("");
      loadStatus();
      fetch("/api/sync-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, provider }),
      }).catch((e) => console.error("sync-now failed", e));
    } catch {
      setStatus("error");
      setErrorMsg("Network error");
    }
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
    lastSyncedLabel: language === "UA" ? "Остання синхронізація" : language === "DE" ? "Letzte Synchronisierung" : "Last synced",
    connected: language === "UA" ? "Підключено" : language === "DE" ? "Verbunden" : "Connected",
    connectBtn: language === "UA" ? `Підключити ${displayName}` : language === "DE" ? `${displayName} verbinden` : `Connect ${displayName}`,
    disconnectBtn: language === "UA" ? "Відключити" : language === "DE" ? "Trennen" : "Disconnect",
    connecting: language === "UA" ? "Підключення..." : language === "DE" ? "Verbinde..." : "Connecting...",
  };

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
      title: language === "UA" ? "Доступно на тарифі Growth" : language === "DE" ? "Verfügbar im Growth-Tarif" : "Available on Growth plan",
      body:
        language === "UA"
          ? `${displayName} доступний на тарифі Growth (1 інтеграція на вибір) або Scale (усі інтеграції).`
          : language === "DE"
          ? `${displayName} ist im Growth-Tarif (1 Integration nach Wahl) oder Scale-Tarif (alle Integrationen) verfügbar.`
          : `${displayName} is available on the Growth plan (pick 1) or the Scale plan (all integrations).`,
      cta: language === "UA" ? "Оновити тариф" : language === "DE" ? "Upgraden" : "Upgrade",
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
          ? `На тарифі Growth доступна 1 додаткова інтеграція. Ви вже обрали ${selectedProviders[0] || "іншу"} на цей billing-період — змінити можна після продовження підписки або переходу на Scale.`
          : language === "DE"
          ? `Der Growth-Tarif erlaubt 1 zusätzliche Integration. Sie haben bereits ${selectedProviders[0] || "eine andere"} für diesen Abrechnungszeitraum gewählt — Änderung ist erst nach Verlängerung oder Upgrade auf Scale möglich.`
          : `Growth plan allows 1 additional integration. You've already picked ${selectedProviders[0] || "another one"} for this billing period — change it after renewal or by upgrading to Scale.`,
      cta: language === "UA" ? "Перейти на Scale" : language === "DE" ? "Auf Scale upgraden" : "Upgrade to Scale",
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
              ? lastSynced
                ? `${texts.lastSyncedLabel}: ${new Date(lastSynced).toLocaleString()}${fields[0] && extraValues[fields[0].key] ? ` · ${extraValues[fields[0].key]}` : ""}`
                : `${texts.connectedWaiting}${fields[0] && extraValues[fields[0].key] ? ` · ${extraValues[fields[0].key]}` : ""}`
              : texts.connectDesc}
          </p>
        </div>
        {status === "connected" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs px-2 py-1 rounded-full font-semibold bg-green-500/20 text-green-400 flex items-center gap-1 font-mono whitespace-nowrap">
              <CheckCircle className="w-3 h-3 shrink-0" /> {texts.connected}{keyPreview ? ` · ${keyPreview}` : ""}
            </span>
            <Button size="sm" variant="outline" className="text-red-400 border-red-400/30 hover:bg-red-500/10 shrink-0" onClick={handleDisconnect}>
              {texts.disconnectBtn}
            </Button>
          </div>
        )}
      </div>

      {status !== "connected" && (
        <div className="space-y-2">
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
          {status === "error" && (
            <p className="text-xs text-red-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {errorMsg}
            </p>
          )}
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={handleConnect} disabled={status === "loading"}>
            {status === "loading" ? texts.connecting : texts.connectBtn}
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
    </div>
  );
}