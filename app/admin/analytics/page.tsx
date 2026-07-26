"use client";

import { useState, useEffect } from "react";
import { useAdminAuth } from "@/components/admin/admin-auth-provider";

interface AnalyticsData {
  totalUsers: number;
  registeredToday: number;
  registeredWeek: number;
  totalBusinesses: number;
  stripeConnected: number;
  telegramConnected: number;
  onboardedCount: number;
  planCounts: Record<string, number>;
  paidCount: number;
  funnel: {
    registered: number;
    createdBusiness: number;
    onboarded: number;
    paid: number;
  };
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

function FunnelBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="mb-3">
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-gray-300">{label}</span>
        <span className="text-gray-500">
          {value} ({pct}%)
        </span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-gray-800">
        <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function AdminAnalyticsPage() {
  const { adminFetch } = useAdminAuth();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await adminFetch("/api/admin/analytics");
      setLoading(false);
      if (!res.ok) return;
      setData(await res.json());
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading || !data) {
    return <p className="p-6 text-sm text-gray-500">Загрузка...</p>;
  }

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold text-white">Аналитика продукта</h1>

      <h2 className="mb-3 font-semibold text-white">Общие цифры</h2>
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Регистраций сегодня" value={data.registeredToday} />
        <StatCard label="Регистраций за 7 дней" value={data.registeredWeek} />
        <StatCard label="Всего пользователей" value={data.totalUsers} />
        <StatCard label="Подключили Stripe" value={data.stripeConnected} />
        <StatCard label="Подключили Telegram" value={data.telegramConnected} />
        <StatCard label="Прошли онбординг" value={data.onboardedCount} />
      </div>

      <h2 className="mb-3 font-semibold text-white">Тарифы</h2>
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Trial" value={data.planCounts.trial} />
        <StatCard label="Starter" value={data.planCounts.starter} />
        <StatCard label="Growth" value={data.planCounts.growth} />
        <StatCard label="Scale" value={data.planCounts.scale} />
        <StatCard label="Заблокировано" value={data.planCounts.blocked} />
        <StatCard label="Всего оплатили" value={data.paidCount} />
      </div>

      <h2 className="mb-3 font-semibold text-white">Воронка (где отваливаются)</h2>
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <FunnelBar label="Зарегистрировались" value={data.funnel.registered} max={data.funnel.registered} />
        <FunnelBar label="Заполнили профиль компании" value={data.funnel.createdBusiness} max={data.funnel.registered} />
        <FunnelBar label="Подключили интеграцию (Stripe/Telegram)" value={data.funnel.onboarded} max={data.funnel.registered} />
        <FunnelBar label="Оплатили тариф" value={data.funnel.paid} max={data.funnel.registered} />
      </div>
    </div>
  );
}