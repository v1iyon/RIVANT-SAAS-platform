"use client";

import { useState, useEffect, useMemo } from "react";
import { useAdminAuth } from "@/components/admin/admin-auth-provider";

interface ErrorLog {
  id: string;
  source: string;
  message: string;
  details: string | null;
  resolved: boolean;
  created_at: string;
}

const SOURCE_LABELS: Record<string, string> = {
  server: "Сервер",
  stripe: "Stripe",
  shopify: "Shopify",
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  telegram: "Telegram",
  ai: "AI",
  ai_explanation: "AI-объяснение",
};

function sourceBadgeClass(source: string) {
  if (source === "stripe") return "bg-purple-500/20 text-purple-300";
  if (source === "shopify") return "bg-green-500/20 text-green-300";
  if (source === "meta_ads" || source === "google_ads") return "bg-orange-500/20 text-orange-300";
  if (source === "telegram") return "bg-blue-500/20 text-blue-300";
  if (source === "ai" || source === "ai_explanation") return "bg-cyan-500/20 text-cyan-300";
  return "bg-red-500/20 text-red-300"; // server / прочее
}

function ErrorCard({
  err,
  onResolve,
  onDelete,
}: {
  err: ErrorLog;
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-white break-words">{err.message}</p>
          {err.details && (
            <p className="mt-1 text-xs text-gray-500 break-words font-mono">{err.details}</p>
          )}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${sourceBadgeClass(err.source)}`}>
          {SOURCE_LABELS[err.source] || err.source}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-gray-500">
          {new Date(err.created_at).toLocaleString("ru-RU")}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => onDelete(err.id)}
            className="rounded-lg bg-gray-800 px-3 py-1 text-xs font-medium text-gray-400 hover:bg-red-900/40 hover:text-red-300"
          >
            Удалить
          </button>
          <button
            onClick={() => onResolve(err.id)}
            className="rounded-lg bg-green-600/20 px-3 py-1 text-xs font-medium text-green-400 hover:bg-green-600/30"
          >
            Решено
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminErrorsPage() {
  const { adminFetch } = useAdminAuth();
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<
    "all" | "server" | "stripe" | "shopify" | "meta_ads" | "google_ads" | "telegram" | "ai" | "ai_explanation"
  >("all");

  const load = async () => {
    setLoading(true);
    const res = await adminFetch("/api/admin/errors");
    setLoading(false);
    if (!res.ok) return;
    const data = await res.json();
    setErrors(data.errors || []);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolveError = async (id: string) => {
    setErrors((prev) => prev.filter((e) => e.id !== id));
    await adminFetch("/api/admin/errors", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, resolved: true }),
    });
  };

  const deleteError = async (id: string) => {
    setErrors((prev) => prev.filter((e) => e.id !== id));
    await adminFetch(`/api/admin/errors?id=${id}`, { method: "DELETE" });
  };

  const filtered = useMemo(() => {
    if (filter === "all") return errors;
    if (filter === "ai") return errors.filter((e) => e.source === "ai" || e.source === "ai_explanation");
    return errors.filter((e) => e.source === filter);
  }, [errors, filter]);

  const openCount = errors.length;
  const counts = useMemo(() => {
    const c: Record<string, number> = {
      server: 0,
      stripe: 0,
      shopify: 0,
      meta_ads: 0,
      google_ads: 0,
      telegram: 0,
      ai: 0,
      ai_explanation: 0,
    };
    errors.forEach((e) => {
      if (c[e.source] !== undefined) c[e.source]++;
    });
    return c;
  }, [errors]);

  if (loading && errors.length === 0) {
    return <p className="p-6 text-sm text-gray-500">Загрузка...</p>;
  }

  const filters: { key: typeof filter; label: string }[] = [
    { key: "all", label: `Все (${openCount})` },
    { key: "server", label: `Сервер (${counts.server})` },
    { key: "stripe", label: `Stripe (${counts.stripe})` },
    { key: "shopify", label: `Shopify (${counts.shopify})` },
    { key: "meta_ads", label: `Meta Ads (${counts.meta_ads})` },
    { key: "google_ads", label: `Google Ads (${counts.google_ads})` },
    { key: "telegram", label: `Telegram (${counts.telegram})` },
    { key: "ai", label: `AI (${counts.ai + counts.ai_explanation})` },
  ];

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold text-white">Ошибки</h1>

      <div className="mb-6 flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === f.key
                ? "bg-blue-600/20 text-blue-400"
                : "bg-gray-900 text-gray-400 hover:bg-gray-800"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.length === 0 && (
          <p className="text-sm text-gray-500">Ошибок нет — всё работает штатно.</p>
        )}
        {filtered.map((err) => (
          <ErrorCard key={err.id} err={err} onResolve={resolveError} onDelete={deleteError} />
        ))}
      </div>
    </div>
  );
}