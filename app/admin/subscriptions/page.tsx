"use client";

import { useState, useEffect, useMemo } from "react";
import { useAdminAuth } from "@/components/admin/admin-auth-provider";

interface SubUser {
  id: string;
  email: string;
  full_name: string | null;
}

interface Subscription {
  id: string;
  plan: string;
  access_status: string;
  current_period_end: string | null;
  created_at: string;
  provider_subscription_id: string | null;
  paddle_subscription_id: string | null;
  users: SubUser | null;
}

function daysUntil(dateStr: string | null) {
  if (!dateStr) return null;
  const diffMs = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function planBadgeClass(plan: string) {
  if (plan === "scale") return "bg-purple-500/20 text-purple-300";
  if (plan === "growth") return "bg-blue-500/20 text-blue-300";
  if (plan === "starter") return "bg-cyan-500/20 text-cyan-300";
  return "bg-gray-500/20 text-gray-300";
}

const PLAN_LABEL_RU: Record<string, string> = {
  trial: "Trial",
  starter: "Starter",
  growth: "Growth",
  scale: "Scale",
};

function Row({ sub }: { sub: Subscription }) {
  const days = daysUntil(sub.current_period_end);
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-white">{sub.users?.full_name || "Без имени"}</p>
          <p className="text-xs text-gray-500">{sub.users?.email}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs ${planBadgeClass(sub.plan)}`}>{PLAN_LABEL_RU[sub.plan] || sub.plan}</span>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-gray-400">
        {sub.current_period_end && (
          <span>
            {days !== null && days >= 0 ? `Осталось ${days} дн.` : "Истёк"} · до{" "}
            {new Date(sub.current_period_end).toLocaleDateString("ru-RU")}
          </span>
        )}
        {sub.provider_subscription_id && <span>Stripe ID есть</span>}
        {sub.paddle_subscription_id && <span>Paddle ID есть</span>}
      </div>
    </div>
  );
}

export default function AdminSubscriptionsPage() {
  const { adminFetch } = useAdminAuth();
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await adminFetch("/api/admin/subscriptions");
      setLoading(false);
      if (!res.ok) return;
      const data = await res.json();
      setSubs(data.subscriptions || []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { paid, cancelled, trialing } = useMemo(() => {
    const paid = subs.filter((s) => s.access_status === "active");
    const cancelled = subs.filter((s) => !["active", "trial"].includes(s.access_status));
    const trialing = subs
      .filter((s) => s.access_status === "trial")
      .sort((a, b) => {
        const da = a.current_period_end ? new Date(a.current_period_end).getTime() : Infinity;
        const db = b.current_period_end ? new Date(b.current_period_end).getTime() : Infinity;
        return da - db;
      });
    return { paid, cancelled, trialing };
  }, [subs]);

  if (loading && subs.length === 0) {
    return <p className="p-6 text-sm text-gray-500">Загрузка...</p>;
  }

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold text-white">Подписки</h1>

      <h2 className="mb-3 font-semibold text-white">Кто оплатил ({paid.length})</h2>
      <div className="mb-10 space-y-3">
        {paid.length === 0 && <p className="text-sm text-gray-500">Пока никто.</p>}
        {paid.map((s) => (
          <Row key={s.id} sub={s} />
        ))}
      </div>

      <h2 className="mb-3 font-semibold text-white">Trial — у кого скоро заканчивается ({trialing.length})</h2>
      <div className="mb-10 space-y-3">
        {trialing.length === 0 && <p className="text-sm text-gray-500">Никто сейчас не на trial.</p>}
        {trialing.map((s) => {
          const days = daysUntil(s.current_period_end);
          const urgent = days !== null && days <= 3;
          return (
            <div key={s.id} className={urgent ? "rounded-xl ring-1 ring-yellow-500/50" : ""}>
              <Row sub={s} />
            </div>
          );
        })}
      </div>

      <h2 className="mb-3 font-semibold text-white">Кто отменил ({cancelled.length})</h2>
      <div className="space-y-3">
        {cancelled.length === 0 && <p className="text-sm text-gray-500">Пока никто не отменял.</p>}
        {cancelled.map((s) => (
          <Row key={s.id} sub={s} />
        ))}
      </div>
    </div>
  );
}