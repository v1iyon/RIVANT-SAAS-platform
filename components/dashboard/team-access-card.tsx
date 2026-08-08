"use client";

// components/dashboard/team-access-card.tsx
//
// Подключить в app/dashboard/page.tsx (по образцу integration-connect-card.tsx):
//   import { TeamAccessCard } from "@/components/dashboard/team-access-card";
//   <TeamAccessCard email={user.email} />
//
// Показывает кнопку "Запросити учасника" (только если подписка team_alerts
// активна — иначе апсейл на /api/orders/create) и список подключённых.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Users, X, Copy } from "lucide-react";

type Member = { id: string; telegram_username: string | null; role: string; created_at: string };

export function TeamAccessCard({ email }: { email: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMembers = async () => {
    const res = await fetch(`/api/team/members?email=${encodeURIComponent(email)}`);
    const data = await res.json();
    setMembers(data.members || []);
  };

  useEffect(() => {
    loadMembers();
  }, [email]);

  const handleInvite = async () => {
    setLoading(true);
    setError(null);
    setInviteUrl(null);
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error === "no_active_subscription" ? "Спочатку підключіть послугу «Сповіщення для команди»" : data.message || "Помилка");
        return;
      }
      setInviteUrl(data.url);
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (memberId: string) => {
    await fetch("/api/team/members", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, memberId }),
    });
    loadMembers();
  };

  return (
    <div className="glass rounded-2xl p-6 border border-white/10">
      <div className="flex items-center gap-2 mb-4">
        <Users className="w-5 h-5 text-primary" />
        <h3 className="font-bold text-lg">Команда</h3>
      </div>

      {members.length > 0 && (
        <ul className="space-y-2 mb-4">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{m.telegram_username ? `@${m.telegram_username}` : "Без username"}</span>
              <button onClick={() => handleRevoke(m.id)} aria-label="Відкликати доступ" className="hover:text-red-400">
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {inviteUrl ? (
        <div className="flex items-center gap-2 text-sm bg-white/5 rounded-lg p-3">
          <span className="truncate flex-1">{inviteUrl}</span>
          <button onClick={() => navigator.clipboard.writeText(inviteUrl)} aria-label="Копіювати">
            <Copy className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <Button variant="outline" className="w-full" onClick={handleInvite} disabled={loading}>
          {loading ? "..." : "Запросити учасника"}
        </Button>
      )}

      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
    </div>
  );
}
