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
  last_synced_at: string | null;
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
const PLAN_LABEL_RU: Record<string, string> = {
  trial: "Trial",
  starter: "Starter",
  growth: "Growth",
  scale: "Scale",
};
const ACCESS_STATUS_LABEL_RU: Record<string, string> = {
  active: "Активна",
  trial: "Триал",
  cancelled: "Отменена",
  expired: "Истекла",
  past_due: "Просрочен платёж",
};

function getSubscription(u: User): Subscription | null {
  return u.subscriptions?.[0] ?? null;
}

// FIX (05.09.2026, п.7 из тудушки): раньше здесь был устаревший список из
// 6 провайдеров (с забытым Plaid, которого в продукте вообще нет) — не
// хватало WooCommerce/PayPal/Mollie, добавленных позже. Единый список из
// 8 интеграций — тот же, что в privacy/page.tsx и lib/plan-slots.js.
const INTEGRATION_LABELS: Record<string, string> = {
  stripe: "Stripe",
  shopify: "Shopify",
  woocommerce: "WooCommerce",
  paypal: "PayPal",
  mollie: "Mollie",
  quickbooks: "QuickBooks",
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
};
const INTEGRATION_ORDER = ["stripe", "shopify", "woocommerce", "paypal", "mollie", "quickbooks", "meta_ads", "google_ads"];

interface ProviderInfo {
  status: string;
  last_synced_at: string | null;
}

// Раньше возвращался просто Set подключённых провайдеров — статус ошибки
// от отсутствия интеграции было не отличить, и last_synced_at нигде не
// прокидывался. Теперь возвращаем полную инфу по каждому провайдеру,
// которая реально есть в БД (SELECT business_id, provider, status,
// last_synced_at FROM integrations — то, о чём и была просьба).
// У пользователя может быть больше одного business с одинаковым
// провайдером (например, после смены компании) — берём "самый живой"
// статус: connected важнее error, error важнее остального, и среди
// одинаковых статусов — с более свежим last_synced_at.
function getIntegrationInfo(u: User): Map<string, ProviderInfo> {
  const rank: Record<string, number> = { connected: 2, error: 1 };
  const info = new Map<string, ProviderInfo>();
  u.businesses?.forEach((b) =>
    b.integrations?.forEach((i) => {
      const existing = info.get(i.provider);
      const existingRank = existing ? rank[existing.status] ?? 0 : -1;
      const currentRank = rank[i.status] ?? 0;
      const isFresher =
        existing?.status === i.status &&
        (i.last_synced_at ?? "") > (existing.last_synced_at ?? "");
      if (!existing || currentRank > existingRank || isFresher) {
        info.set(i.provider, { status: i.status, last_synced_at: i.last_synced_at });
      }
    })
  );
  return info;
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
          const integrationInfo = getIntegrationInfo(u);
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
                      {PLAN_LABEL_RU[sub.plan] || sub.plan}
                    </span>
                  )}
                  {sub && (
                    <span className={`rounded-full px-2 py-0.5 text-xs ${accessBadgeClass(sub.access_status)}`}>
                      {ACCESS_STATUS_LABEL_RU[sub.access_status] || sub.access_status}
                    </span>
                  )}
                </div>
              </div>

              <div className="mb-3 flex flex-wrap gap-3 text-xs text-gray-400">
                {INTEGRATION_ORDER.map((key) => {
                  const provider = integrationInfo.get(key);
                  const status = provider?.status;
                  const icon = status === "connected" ? "✓" : status === "error" ? "⚠" : "—";
                  const colorClass =
                    status === "connected"
                      ? "text-green-400"
                      : status === "error"
                      ? "text-red-400"
                      : "text-gray-600";
                  const syncedLabel = provider?.last_synced_at
                    ? `, синк: ${new Date(provider.last_synced_at).toLocaleString("ru-RU")}`
                    : "";
                  const title = status
                    ? `${INTEGRATION_LABELS[key]} — ${status}${syncedLabel}`
                    : `${INTEGRATION_LABELS[key]} — не подключено`;
                  return (
                    <span key={key} className={colorClass} title={title}>
                      {icon} {INTEGRATION_LABELS[key]}
                      {status === "connected" && provider?.last_synced_at && (
                        <span className="text-gray-500">
                          {" "}
                          ({new Date(provider.last_synced_at).toLocaleDateString("ru-RU")})
                        </span>
                      )}
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
                      {PLAN_LABEL_RU[p]}
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