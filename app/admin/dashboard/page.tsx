"use client";

import { useEffect, useState } from "react";
import { useAdminAuth } from "@/components/admin/admin-auth-provider";
import { Users, CreditCard, Hourglass, TrendingUp, AlertTriangle } from "lucide-react";

interface Metrics {
  totalUsers: number;
  activeSubscriptions: number;
  trialUsers: number;
  mrrCents: number;
  errorsToday: number;
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export default function AdminDashboardPage() {
  const { adminFetch } = useAdminAuth();
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    adminFetch("/api/admin/dashboard").then(async (res: Response) => {
      if (!res.ok) return;
      setMetrics(await res.json());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!metrics) {
    return <p className="p-6 text-sm text-gray-500">Загрузка...</p>;
  }

  const cards = [
    { label: "Пользователей", value: metrics.totalUsers.toLocaleString("ru-RU"), icon: Users },
    { label: "Активные подписки", value: metrics.activeSubscriptions.toLocaleString("ru-RU"), icon: CreditCard },
    { label: "На триале", value: metrics.trialUsers.toLocaleString("ru-RU"), icon: Hourglass },
    { label: "MRR", value: formatMoney(metrics.mrrCents), icon: TrendingUp },
    {
      label: "Ошибок сегодня",
      value: metrics.errorsToday.toLocaleString("ru-RU"),
      icon: AlertTriangle,
      danger: metrics.errorsToday > 0,
    },
  ];

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold text-white">Дашборд</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-gray-500">{c.label}</span>
                <Icon className={`h-4 w-4 ${c.danger ? "text-red-400" : "text-gray-500"}`} />
              </div>
              <div className={`text-2xl font-bold ${c.danger ? "text-red-400" : "text-white"}`}>
                {c.value}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}