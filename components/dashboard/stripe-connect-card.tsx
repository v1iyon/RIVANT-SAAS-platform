"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle, AlertCircle } from "lucide-react";
import { useLanguage } from "@/lib/translations";

export function StripeConnectCard({ email }: { email: string }) {
  const { language } = useLanguage();
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "connected" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  const loadStatus = () => {
    if (!email) return;
    fetch(`/api/business-status?email=${encodeURIComponent(email)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.business?.stripe_connected) {
          setStatus("connected");
          setLastSynced(d.business.last_synced_at);
        } else {
          setStatus("idle");
        }
      });
  };

  useEffect(() => {
    loadStatus();
  }, [email]);

  const handleConnect = async () => {
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
      setApiKey("");
      loadStatus();
    } catch {
      setStatus("error");
      setErrorMsg("Network error");
    }
  };

  const handleDisconnect = async () => {
    await fetch("/api/stripe-disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setStatus("idle");
    setLastSynced(null);
  };

  const texts = {
    connectDesc:
      language === "UA"
        ? "Підключіть Stripe, щоб отримувати реальні дані про виручку"
        : language === "DE"
        ? "Verbinden Sie Stripe, um echte Umsatzdaten abzurufen"
        : "Connect your Stripe account to pull real revenue data",
    connectedWaiting:
      language === "UA"
        ? "Підключено, очікуємо першу синхронізацію"
        : language === "DE"
        ? "Verbunden, wartet auf erste Synchronisierung"
        : "Connected, waiting for first sync",
    lastSynced:
      language === "UA" ? "Остання синхронізація" : language === "DE" ? "Letzte Synchronisierung" : "Last synced",
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
  };

  return (
    <div className="bg-gray-900/30 rounded-xl p-5 border border-gray-800">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="font-semibold text-white">Stripe</h4>
          <p className="text-xs text-gray-500">
            {status === "connected"
              ? lastSynced
                ? `${texts.lastSynced}: ${new Date(lastSynced).toLocaleString()}`
                : texts.connectedWaiting
              : texts.connectDesc}
          </p>
        </div>
        {status === "connected" && (
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-1 rounded-full font-semibold bg-green-500/20 text-green-400 flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> {texts.connected}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="text-red-400 border-red-400/30 hover:bg-red-500/10"
              onClick={handleDisconnect}
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