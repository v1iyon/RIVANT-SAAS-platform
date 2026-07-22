"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle, AlertCircle } from "lucide-react";

export function StripeConnectCard({ email }: { email: string }) {
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "connected" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  useEffect(() => {
    if (!email) return;
    fetch(`/api/business-status?email=${encodeURIComponent(email)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.business?.stripe_connected) {
          setStatus("connected");
          setLastSynced(d.business.last_synced_at);
        }
      });
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
      setStatus("connected");
      setApiKey("");
    } catch {
      setStatus("error");
      setErrorMsg("Network error");
    }
  };

  return (
    <div className="bg-gray-900/30 rounded-xl p-5 border border-gray-800">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="font-semibold text-white">Stripe</h4>
          <p className="text-xs text-gray-500">
            {status === "connected"
              ? lastSynced
                ? `Last synced: ${new Date(lastSynced).toLocaleString()}`
                : "Connected, waiting for first sync"
              : "Connect your Stripe account to pull real revenue data"}
          </p>
        </div>
        {status === "connected" && (
          <span className="text-xs px-2 py-1 rounded-full font-semibold bg-green-500/20 text-green-400 flex items-center gap-1">
            <CheckCircle className="w-3 h-3" /> Connected
          </span>
        )}
      </div>

      {status !== "connected" && (
        <div className="space-y-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="rk_live_... (restricted, read-only key)"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <p className="text-xs text-gray-500">
            Create a <strong>restricted key</strong> with read-only access in Stripe Dashboard → Developers → API keys → Create restricted key.
          </p>
          {status === "error" && (
            <p className="text-xs text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {errorMsg}</p>
          )}
          <Button
            size="sm"
            className="bg-blue-600 hover:bg-blue-700"
            onClick={handleConnect}
            disabled={status === "loading"}
          >
            {status === "loading" ? "Connecting..." : "Connect Stripe"}
          </Button>
        </div>
      )}
    </div>
  );
}