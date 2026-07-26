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
  telegram: "Telegram",
  ai: "AI",
};

function sourceBadgeClass(source: string) {
  if (source === "stripe") return "bg-purple-500/20 text-purple-300";
  if (source === "telegram") return "bg-blue-500/20 text-blue-300";
  if (source === "ai") return "bg-cyan-500/20 text-cyan-300";
  return "bg-red-500/20 text-red-300"; // server / прочее
}

function ErrorCard({
  err,
  onToggleResolved,
}: {
  err: ErrorLog;
  onToggleResolved: (id: string, resolved: boolean) => void;
}) {
  return (
    <div className={`rounded-xl border p-4 ${err.resolved ? "border-gray-800/50 bg-gray-900/40 opacity-60" : "border-gray-800 bg-gray-900"}`}>
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
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-gray-500">
          {new Date(err.created_at).toLocaleString("ru-RU")}
        </span>
        <button
          onClick={() => onToggleResolved(err.id, !err.resolved)}
          className={`rounded-lg px-3 py-1 text-xs font-medium ${
            err.resolved
              ? "bg-gray-800 text-gray-400 hover:bg-gray-700"
              : "bg-green-600/20 text-green-400 hover:bg-green-600/30"
          }`}
        >
          {err.resolved ? "Вернуть в открытые" : "Отметить решённой"}
        </button>
      </div>
    </div>
  );
}

export default function AdminErrorsPage() {
  const { adminFetch } = useAdminAuth();
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "server" | "stripe" | "telegram" | "ai">("all");

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

  const toggleResolved = async (id: string, resolved: boolean) => {
    setErrors((prev) => prev.map((e) => (e.id === id ? { ...e, resolved } : e)));
    await adminFetch("/api/admin/errors", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, resolved }),
    });
  };

  const filtered = useMemo(() => {
    if (filter === "all") return errors;
    return errors.filter((e) => e.source === filter);
  }, [errors, filter]);

  const openCount = errors.filter((e) => !e.resolved).length;
  const counts = useMemo(() => {
    const c: Record<string, number> = { server: 0, stripe: 0, telegram: 0, ai: 0 };
    errors.forEach((e) => {
      if (!e.resolved && c[e.source] !== undefined) c[e.source]++;
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
    { key: "telegram", label: `Telegram (${counts.telegram})` },
    { key: "ai", label: `AI (${counts.ai})` },
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
          <ErrorCard key={err.id} err={err} onToggleResolved={toggleResolved} />
        ))}
      </div>
    </div>
  );
}