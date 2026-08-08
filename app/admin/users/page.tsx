"use client";

import { useState, useEffect, useMemo } from "react";
import { useAdminAuth } from "@/components/admin/admin-auth-provider";

interface Subscription {
  plan: string;
  access_status: string;
  current_period_end: string | null;
}

interface Integration {
  provider: string;
  status: string;
}

interface Business {
  id: string;
  name: string;
  integrations: Integration[];
}

interface User {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  telegram_id: number | null;
  language: string | null;
  is_blocked: boolean;
  created_at: string;
  subscriptions: Subscription[];
  businesses: Business[];
}

const PLAN_OPTIONS = ["trial", "starter", "growth", "scale"] as const;

function getSubscription(u: User): Subscription | null {
  return u.subscriptions?.[0] ?? null;
}

const INTEGRATION_LABELS: Record<string, string> = {
  stripe: "Stripe",
  shopify: "Shopify",
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  quickbooks: "QuickBooks",
  google_analytics: "Google Analytics",
};
const INTEGRATION_ORDER = ["stripe", "shopify", "meta_ads", "google_ads", "quickbooks", "google_analytics"];

function getConnectedProviders(u: User): Set<string> {
  const connected = new Set<string>();
  u.businesses?.forEach((b) =>
    b.integrations?.forEach((i) => {
      if (i.status === "connected") connected.add(i.provider);
    })
  );
  return connected;
}

function planBadgeClass(plan: string) {
  if (plan === "scale") return "bg-purple-500/20 text-purple-300";
  if (plan === "growth") return "bg-blue-500/20 text-blue-300";
  if (plan === "starter") return "bg-cyan-500/20 text-cyan-300";
  return "bg-gray-500/20 text-gray-300"; // trial
}

function accessBadgeClass(status: string) {
  if (status === "active") return "bg-green-500/20 text-green-400";
  if (status === "trial") return "bg-yellow-500/20 text-yellow-400";
  return "bg-red-500/20 text-red-400";
}

export default function AdminUsersPage() {
  const { adminFetch } = useAdminAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    const res = await adminFetch("/api/admin/users");
    setLoading(false);
    if (!res.ok) return;
    const data = await res.json();
    setUsers(data.users || []);
  };

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleBlocked = async (u: User) => {
    const next = !u.is_blocked;
    if (next && !confirm(`Заблокировать пользователя ${u.email}?`)) return;
    setSavingId(u.id);
    await adminFetch("/api/admin/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: u.id, is_blocked: next }),
    });
    setSavingId(null);
    loadUsers();
  };

  const changePlan = async (u: User, plan: string) => {
    setSavingId(u.id);
    await adminFetch("/api/admin/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: u.id, plan }),
    });
    setSavingId(null);
    loadUsers();
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.email?.toLowerCase().includes(q) ||
        u.full_name?.toLowerCase().includes(q) ||
        u.phone?.toLowerCase().includes(q)
    );
  }, [users, query]);

  if (loading && users.length === 0) {
    return <p className="p-6 text-sm text-gray-500">Загрузка...</p>;
  }

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold text-white">Пользователи ({users.length})</h1>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Поиск по имени, email или телефону..."
        className="mb-6 w-full max-w-md rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-white placeholder:text-gray-500"
      />

      <div className="space-y-3">
        {filtered.length === 0 && <p className="text-sm text-gray-500">Ничего не найдено.</p>}
        {filtered.map((u) => {
          const sub = getSubscription(u);
          const connected = getConnectedProviders(u);
          const telegramOk = Boolean(u.telegram_id);
          const isSaving = savingId === u.id;

          return (
            <div key={u.id} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-white">
                    {u.full_name || "Без имени"}
                    {u.is_blocked && (
                      <span className="ml-2 rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-400">
                        Заблокирован
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">{u.email}</p>
                  {u.phone && <p className="text-xs text-gray-500">{u.phone}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {sub && (
                    <span className={`rounded-full px-2 py-0.5 text-xs ${planBadgeClass(sub.plan)}`}>
                      {sub.plan}
                    </span>
                  )}
                  {sub && (
                    <span className={`rounded-full px-2 py-0.5 text-xs ${accessBadgeClass(sub.access_status)}`}>
                      {sub.access_status}
                    </span>
                  )}
                </div>
              </div>

              <div className="mb-3 flex flex-wrap gap-3 text-xs text-gray-400">
                {INTEGRATION_ORDER.map((key) => {
                  const ok = connected.has(key);
                  return (
                    <span key={key} className={ok ? "text-green-400" : "text-gray-600"}>
                      {ok ? "✓" : "—"} {INTEGRATION_LABELS[key]}
                    </span>
                  );
                })}
                <span className={telegramOk ? "text-green-400" : "text-gray-600"}>
                  {telegramOk ? "✓" : "—"} Telegram
                </span>
                {sub?.current_period_end && (
                  <span>До: {new Date(sub.current_period_end).toLocaleDateString("ru-RU")}</span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={sub?.plan ?? ""}
                  disabled={!sub || isSaving}
                  onChange={(e) => changePlan(u, e.target.value)}
                  className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white disabled:opacity-50"
                >
                  {!sub && <option value="">Нет подписки</option>}
                  {PLAN_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>

                <button
                  onClick={() => toggleBlocked(u)}
                  disabled={isSaving}
                  className={`ml-auto rounded-lg px-3 py-1.5 text-xs disabled:opacity-50 ${
                    u.is_blocked
                      ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                      : "bg-red-900/40 text-red-300 hover:bg-red-900/70"
                  }`}
                >
                  {u.is_blocked ? "Разблокировать" : "Заблокировать"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}