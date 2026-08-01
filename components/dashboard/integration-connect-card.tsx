"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle, AlertCircle, Lock } from "lucide-react";
import { useLanguage } from "@/lib/translations";

interface Props {
  email: string;
  provider: string; // must match SUPPORTED_PROVIDERS in the API routes
  displayName: string;
  placeholder: string;
  hint: string;
  // Когда true — карточка полностью серая, клик в любом месте (включая
  // попытку ввести ключ или нажать connect) уводит на прайсинг вместо
  // реального подключения. Используется для "триал закончился" — намеренно
  // без текста вроде "доступно на тарифі X", просто неактивный вид.
  locked?: boolean;
  onLockedClick?: () => void;
}

// Generic version of StripeConnectCard for the providers already supported by
// /api/integrations-status + /api/connect-integration (meta_ads, google_ads,
// shopify, quickbooks, plaid) — these used to be a static "Coming soon" block
// even though the backend to actually connect them already existed.
export function IntegrationConnectCard({ email, provider, displayName, placeholder, hint, locked = false, onLockedClick }: Props) {
  const { language } = useLanguage();
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<"checking" | "idle" | "loading" | "connected" | "error">("checking");
  const [errorMsg, setErrorMsg] = useState("");
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [keyPreview, setKeyPreview] = useState<string | null>(null);

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

  const handleConnect = async () => {
    if (locked) {
      onLockedClick?.();
      return;
    }
    if (!apiKey.trim()) return;
    setStatus("loading");
    setErrorMsg("");
    try {
      const res = await fetch("/api/connect-integration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, provider, apiKey: apiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setErrorMsg(data.error || "Connection failed");
        return;
      }
      setApiKey("");
      loadStatus();
    } catch {
      setStatus("error");
      setErrorMsg("Network error");
    }
  };

  const handleDisconnect = async () => {
    if (locked) {
      onLockedClick?.();
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
  };

  const texts = {
    connectDesc:
      language === "UA"
        ? `Підключіть ${displayName}, щоб отримувати реальні дані`
        : language === "DE"
        ? `Verbinden Sie ${displayName}, um echte Daten abzurufen`
        : `Connect ${displayName} to pull real data`,
    connectedWaiting:
      language === "UA"
        ? "Підключено, очікуємо першу синхронізацію"
        : language === "DE"
        ? "Verbunden, wartet auf erste Synchronisierung"
        : "Connected, waiting for first sync",
    lastSyncedLabel:
      language === "UA" ? "Остання синхронізація" : language === "DE" ? "Letzte Synchronisierung" : "Last synced",
    connected: language === "UA" ? "Підключено" : language === "DE" ? "Verbunden" : "Connected",
    connectBtn:
      language === "UA" ? `Підключити ${displayName}` : language === "DE" ? `${displayName} verbinden` : `Connect ${displayName}`,
    disconnectBtn: language === "UA" ? "Відключити" : language === "DE" ? "Trennen" : "Disconnect",
    connecting: language === "UA" ? "Підключення..." : language === "DE" ? "Verbinde..." : "Connecting...",
  };

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
    <div
      className={`bg-gray-900/30 rounded-xl p-5 border border-gray-800 relative transition-opacity ${
        locked ? "opacity-40 cursor-pointer select-none" : ""
      }`}
      onClick={locked ? () => onLockedClick?.() : undefined}
    >
      {locked && (
        <div className="absolute top-4 right-4 text-gray-500">
          <Lock className="w-4 h-4" />
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h4 className="font-semibold text-white">{displayName}</h4>
          <p className="text-xs text-gray-500">
            {status === "connected"
              ? lastSynced
                ? `${texts.lastSyncedLabel}: ${new Date(lastSynced).toLocaleString()}`
                : texts.connectedWaiting
              : texts.connectDesc}
          </p>
        </div>
        {status === "connected" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs px-2 py-1 rounded-full font-semibold bg-green-500/20 text-green-400 flex items-center gap-1 font-mono whitespace-nowrap">
              <CheckCircle className="w-3 h-3 shrink-0" /> {texts.connected}{keyPreview ? ` · ${keyPreview}` : ""}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="text-red-400 border-red-400/30 hover:bg-red-500/10 shrink-0"
              onClick={handleDisconnect}
              disabled={locked}
            >
              {texts.disconnectBtn}
            </Button>
          </div>
        )}
      </div>

      {status !== "connected" && (
        <div className="space-y-2">
          <input
            type="text"
            value={apiKey}
            onChange={(e) => !locked && setApiKey(e.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-lpignore="true"
            data-1p-ignore="true"
            name={`rivant-${provider}-key-field`}
            readOnly={locked}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:cursor-pointer"
          />
          <p className="text-xs text-gray-500">{hint}</p>
          {status === "error" && (
            <p className="text-xs text-red-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {errorMsg}
            </p>
          )}
          <Button
            size="sm"
            className="bg-blue-600 hover:bg-blue-700"
            onClick={handleConnect}
            disabled={status === "loading"}
          >
            {status === "loading" ? texts.connecting : texts.connectBtn}
          </Button>
        </div>
      )}
    </div>
  );
}