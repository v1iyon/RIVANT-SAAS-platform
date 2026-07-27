"use client";

import { useState, useEffect, useMemo } from "react";
import { useAdminAuth } from "@/components/admin/admin-auth-provider";

interface FeedbackItem {
  id: string;
  email: string;
  type: "bug" | "feature";
  message: string;
  status: "new" | "reviewed" | "resolved";
  created_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  new: "Новое",
  reviewed: "Просмотрено",
  resolved: "Решено",
};

function typeBadgeClass(type: string) {
  return type === "bug" ? "bg-red-500/20 text-red-300" : "bg-blue-500/20 text-blue-300";
}

function statusBadgeClass(status: string) {
  if (status === "resolved") return "bg-green-500/20 text-green-400";
  if (status === "reviewed") return "bg-yellow-500/20 text-yellow-400";
  return "bg-gray-500/20 text-gray-300";
}

export default function AdminFeedbackPage() {
  const { adminFetch } = useAdminAuth();
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "bug" | "feature">("all");

  const load = async () => {
    setLoading(true);
    const res = await adminFetch("/api/admin/feedback");
    setLoading(false);
    if (!res.ok) return;
    const data = await res.json();
    setItems(data.feedback || []);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateStatus = async (id: string, status: string) => {
    setItems((prev) => prev.map((f) => (f.id === id ? { ...f, status: status as any } : f)));
    await adminFetch("/api/admin/feedback", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
  };

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((f) => f.type === filter);
  }, [items, filter]);

  if (loading && items.length === 0) {
    return <p className="p-6 text-sm text-gray-500">Загрузка...</p>;
  }

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold text-white">Обратная связь</h1>

      <div className="mb-6 flex gap-2">
        {(["all", "bug", "feature"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              filter === f ? "bg-blue-600/20 text-blue-400" : "bg-gray-900 text-gray-400 hover:bg-gray-800"
            }`}
          >
            {f === "all" ? "Все" : f === "bug" ? "Проблемы" : "Предложения"}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.length === 0 && <p className="text-sm text-gray-500">Пока ничего нет.</p>}
        {filtered.map((f) => (
          <div key={f.id} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
  <div className="flex flex-wrap items-center gap-2 min-w-0">
    <span className={`rounded-full px-2 py-0.5 text-xs shrink-0 ${typeBadgeClass(f.type)}`}>
      {f.type === "bug" ? "Проблема" : "Предложение"}
    </span>
    <span className="text-xs text-gray-500 truncate max-w-[220px]">{f.email}</span>
  </div>
              <span className={`rounded-full px-2 py-0.5 text-xs ${statusBadgeClass(f.status)}`}>
                {STATUS_LABELS[f.status]}
              </span>
            </div>
            <p className="mb-3 text-white">{f.message}</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-gray-500">{new Date(f.created_at).toLocaleString("ru-RU")}</span>
              <select
                value={f.status}
                onChange={(e) => updateStatus(f.id, e.target.value)}
                className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white"
              >
                <option value="new">Новое</option>
                <option value="reviewed">Просмотрено</option>
                <option value="resolved">Решено</option>
              </select>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}