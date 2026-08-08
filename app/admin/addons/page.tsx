"use client";

import { useState, useEffect, useMemo } from "react";
import { useAdminAuth } from "@/components/admin/admin-auth-provider";

interface AddonUser {
  id: string;
  email: string;
  full_name: string | null;
}

interface AddonBusiness {
  id: string;
  name: string | null;
  users: AddonUser | null;
}

interface AddonSubscription {
  id: string;
  addon_type: "monthly_digest" | "team_alerts" | string;
  status: string;
  current_period_end: string | null;
  paddle_subscription_id: string | null;
  created_at: string;
  business_id: string;
  businesses: AddonBusiness | null;
}

const ADDON_LABEL: Record<string, string> = {
  monthly_digest: "AI-Дайджест ефективності",
  team_alerts: "Сповіщення для команди",
};

function daysUntil(dateStr: string | null) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function Row({ addon }: { addon: AddonSubscription }) {
  const days = daysUntil(addon.current_period_end);
  const expiringSoon = addon.status === "active" && days !== null && days <= 3;
  return (
    <div className={`rounded-xl border border-gray-800 bg-gray-900 p-4 ${expiringSoon ? "ring-1 ring-yellow-500/50" : ""}`}>
      <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-white">{ADDON_LABEL[addon.addon_type] || addon.addon_type}</p>
          <p className="text-xs text-gray-500">
            {addon.businesses?.users?.full_name || "Без имени"} · {addon.businesses?.users?.email}
            {addon.businesses?.name ? ` · ${addon.businesses.name}` : ""}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            addon.status === "active" ? "bg-green-500/20 text-green-400" : "bg-gray-500/20 text-gray-400"
          }`}
        >
          {addon.status}
        </span>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-gray-400">
        {addon.current_period_end && (
          <span>
            {days !== null && days >= 0 ? `Осталось ${days} дн.` : "Истёк"} · до{" "}
            {new Date(addon.current_period_end).toLocaleDateString("ru-RU")}
          </span>
        )}
        {addon.paddle_subscription_id && <span>Paddle ID есть</span>}
      </div>
    </div>
  );
}

export default function AdminAddonsPage() {
  const { adminFetch } = useAdminAuth();
  const [addons, setAddons] = useState<AddonSubscription[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await adminFetch("/api/admin/addons");
      setLoading(false);
      if (!res.ok) return;
      const data = await res.json();
      setAddons(data.addons || []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byType = useMemo(() => {
    const active = addons.filter((a) => a.status === "active");
    const inactive = addons.filter((a) => a.status !== "active");
    return {
      digestActive: active.filter((a) => a.addon_type === "monthly_digest"),
      teamActive: active.filter((a) => a.addon_type === "team_alerts"),
      inactive,
    };
  }, [addons]);

  if (loading && addons.length === 0) {
    return <p className="p-6 text-sm text-gray-500">Загрузка...</p>;
  }

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold text-white">Addon-подписки</h1>

      <h2 className="mb-3 font-semibold text-white">
        AI-Дайджест ефективності — активные ({byType.digestActive.length})
      </h2>
      <div className="mb-10 space-y-3">
        {byType.digestActive.length === 0 && <p className="text-sm text-gray-500">Пока никто не подключил.</p>}
        {byType.digestActive.map((a) => (
          <Row key={a.id} addon={a} />
        ))}
      </div>

      <h2 className="mb-3 font-semibold text-white">
        Сповіщення для команди — активные ({byType.teamActive.length})
      </h2>
      <div className="mb-10 space-y-3">
        {byType.teamActive.length === 0 && <p className="text-sm text-gray-500">Пока никто не подключил.</p>}
        {byType.teamActive.map((a) => (
          <Row key={a.id} addon={a} />
        ))}
      </div>

      <h2 className="mb-3 font-semibold text-white">Неактивные / отменённые ({byType.inactive.length})</h2>
      <div className="space-y-3">
        {byType.inactive.length === 0 && <p className="text-sm text-gray-500">Таких нет.</p>}
        {byType.inactive.map((a) => (
          <Row key={a.id} addon={a} />
        ))}
      </div>
    </div>
  );
}