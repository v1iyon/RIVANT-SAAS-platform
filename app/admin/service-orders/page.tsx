"use client";

import { useState, useEffect, useMemo } from "react";
import { useAdminAuth } from "@/components/admin/admin-auth-provider";

interface OrderUser {
  id: string;
  email: string;
  full_name: string | null;
}

interface ServiceOrder {
  id: string;
  service_type: string;
  status: "pending" | "processing" | "delivered" | "failed";
  error_message: string | null;
  report_summary: string | null;
  paddle_transaction_id: string | null;
  created_at: string;
  delivered_at: string | null;
  business_id: string;
  users: OrderUser | null;
}

// Названия услуг оставлены на украинском — так же, как они называются
// на маркетинговом сайте (lib/translations.tsx, UA).
const SERVICE_LABEL: Record<string, string> = {
  whatif_analysis: "AI-Реконструкція минулого",
  monthly_digest: "AI-Дайджест ефективності",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "В очереди",
  processing: "В обработке",
  delivered: "Доставлено",
  failed: "Ошибка",
};

function statusBadgeClass(status: string) {
  if (status === "delivered") return "bg-green-500/20 text-green-400";
  if (status === "failed") return "bg-red-500/20 text-red-400";
  if (status === "processing") return "bg-blue-500/20 text-blue-400";
  return "bg-yellow-500/20 text-yellow-400"; // pending
}

function Row({ order }: { order: ServiceOrder }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-white">{SERVICE_LABEL[order.service_type] || order.service_type}</p>
          <p className="text-xs text-gray-500">
            {order.users?.full_name || "Без имени"} · {order.users?.email}
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs ${statusBadgeClass(order.status)}`}>
          {STATUS_LABEL[order.status] || order.status}
        </span>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-gray-400">
        <span>Создан: {new Date(order.created_at).toLocaleString("ru-RU")}</span>
        {order.delivered_at && <span>Доставлен: {new Date(order.delivered_at).toLocaleString("ru-RU")}</span>}
        {order.paddle_transaction_id && <span>Paddle: {order.paddle_transaction_id}</span>}
      </div>
      {order.error_message && (
        <p className="mt-2 rounded-lg bg-red-500/10 p-2 text-xs text-red-300">{order.error_message}</p>
      )}
      {order.report_summary && (
        <p className="mt-2 whitespace-pre-line rounded-lg bg-gray-800/60 p-2 text-xs text-gray-300">
          {order.report_summary}
        </p>
      )}
    </div>
  );
}

export default function AdminServiceOrdersPage() {
  const { adminFetch } = useAdminAuth();
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const res = await adminFetch("/api/admin/service-orders");
    setLoading(false);
    if (!res.ok) return;
    const data = await res.json();
    setOrders(data.orders || []);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runPending = async () => {
    setProcessing(true);
    const res = await adminFetch("/api/admin/service-orders", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setProcessing(false);
    setLastRun(
      res.ok
        ? `Обработано: ${data.cronResult?.processed ?? 0}`
        : "Ошибка запуска — проверь CRON_SECRET / NEXT_PUBLIC_SITE_URL"
    );
    load();
  };

  const { pending, processingList, delivered, failed } = useMemo(() => {
    return {
      pending: orders.filter((o) => o.status === "pending"),
      processingList: orders.filter((o) => o.status === "processing"),
      delivered: orders.filter((o) => o.status === "delivered"),
      failed: orders.filter((o) => o.status === "failed"),
    };
  }, [orders]);

  if (loading && orders.length === 0) {
    return <p className="p-6 text-sm text-gray-500">Загрузка...</p>;
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">Допуслуги</h1>
        <div className="flex items-center gap-3">
          {lastRun && <span className="text-xs text-gray-500">{lastRun}</span>}
          <button
            onClick={runPending}
            disabled={processing || pending.length === 0}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {processing ? "Обрабатываю..." : `Обработать сейчас (${pending.length})`}
          </button>
        </div>
      </div>


      <h2 className="mb-3 font-semibold text-white">В очереди ({pending.length})</h2>
      <div className="mb-10 space-y-3">
        {pending.length === 0 && <p className="text-sm text-gray-500">Ничего не ждёт обработки.</p>}
        {pending.map((o) => (
          <Row key={o.id} order={o} />
        ))}
      </div>

      <h2 className="mb-3 font-semibold text-white">В обработке ({processingList.length})</h2>
      <div className="mb-10 space-y-3">
        {processingList.length === 0 && <p className="text-sm text-gray-500">Пусто.</p>}
        {processingList.map((o) => (
          <Row key={o.id} order={o} />
        ))}
      </div>

      <h2 className="mb-3 font-semibold text-white">Ошибки ({failed.length})</h2>
      <div className="mb-10 space-y-3">
        {failed.length === 0 && <p className="text-sm text-gray-500">Ошибок нет.</p>}
        {failed.map((o) => (
          <Row key={o.id} order={o} />
        ))}
      </div>

      <h2 className="mb-3 font-semibold text-white">Доставлено ({delivered.length})</h2>
      <div className="space-y-3">
        {delivered.length === 0 && <p className="text-sm text-gray-500">Пока ничего не доставлено.</p>}
        {delivered.map((o) => (
          <Row key={o.id} order={o} />
        ))}
      </div>
    </div>
  );
}