"use client";

import { useState, useEffect } from "react";
import { useAdminAuth } from "@/components/admin/admin-auth-provider";

interface BroadcastItem {
  id: string;
  message: string;
  sent_telegram: boolean;
  sent_inapp: boolean;
  telegram_sent_count: number;
  created_at: string;
}

export default function AdminNotificationsPage() {
  const { adminFetch } = useAdminAuth();
  const [message, setMessage] = useState("");
  const [viaTelegram, setViaTelegram] = useState(true);
  const [viaInApp, setViaInApp] = useState(true);
  const [sending, setSending] = useState(false);
  const [resultMsg, setResultMsg] = useState("");
  const [history, setHistory] = useState<BroadcastItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expireDays, setExpireDays] = useState<string>("");

  const loadHistory = async () => {
    setLoading(true);
    const res = await adminFetch("/api/admin/notifications");
    setLoading(false);
    if (!res.ok) return;
    const data = await res.json();
    setHistory(data.notifications || []);
  };

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSend = async () => {
    if (!message.trim()) return;
    if (!viaTelegram && !viaInApp) {
      setResultMsg("Выберите хотя бы один канал");
      return;
    }
    setSending(true);
    setResultMsg("");
    const res = await adminFetch("/api/admin/notifications/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, viaTelegram, viaInApp, expireDays: expireDays ? Number(expireDays) : null }),
    });
    setSending(false);
    if (res.ok) {
      const data = await res.json();
      setResultMsg(
        viaTelegram
          ? `Отправлено. В Telegram доставлено: ${data.telegramSentCount}`
          : "Отправлено."
      );
      setMessage("");
      loadHistory();
    } else {
      const data = await res.json().catch(() => ({}));
      setResultMsg(data.error || "Ошибка отправки");
    }
  };

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold text-white">Уведомления</h1>

      <div className="mb-8 rounded-xl border border-gray-800 bg-gray-900 p-4">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Например: Сегодня вышло обновление..."
          className="mb-3 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder:text-gray-500 min-h-[100px]"
        />
        <div className="mb-3 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={viaTelegram} onChange={(e) => setViaTelegram(e.target.checked)} />
            Telegram
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={viaInApp} onChange={(e) => setViaInApp(e.target.checked)} />
            Баннер в кабинете
          </label>
        </div>
        {resultMsg && <p className="mb-3 text-sm text-blue-400">{resultMsg}</p>}
        <button
          onClick={handleSend}
          disabled={sending || !message.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {sending ? "Отправка..." : "Отправить"}
        </button>
      </div>

      <div className="mb-3">
  <label className="text-xs text-gray-500 block mb-1">
    Показывать N дней (необязательно, оставьте пустым — бессрочно)
  </label>
  <input
    type="number"
    min="1"
    value={expireDays}
    onChange={(e) => setExpireDays(e.target.value)}
    placeholder="Например: 7"
    className="w-32 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white"
  />
</div>

      <h2 className="mb-3 font-semibold text-white">История рассылок</h2>
      {loading && <p className="text-sm text-gray-500">Загрузка...</p>}
      <div className="space-y-3">
        {history.map((n) => (
          <div key={n.id} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <p className="text-white">{n.message}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
              <span>{new Date(n.created_at).toLocaleString("ru-RU")}</span>
              {n.sent_telegram && <span>Telegram: {n.telegram_sent_count}</span>}
              {n.sent_inapp && <span>Баннер в кабинете</span>}
            </div>
          </div>
        ))}
        {!loading && history.length === 0 && (
          <p className="text-sm text-gray-500">Рассылок пока не было.</p>
        )}
      </div>
    </div>
  );
}
