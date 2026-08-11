"use client";

// components/dashboard/team-access-card.tsx
//
// Подключить в app/dashboard/page.tsx как СТРОКУ внутри карточки
// "Notification Preferences" (сразу под Telegram Notifications), а не как
// отдельную полноширинную карточку — визуально должно совпадать с рядами
// Push/Email/Telegram выше:
//   import { TeamAccessCard } from "@/components/dashboard/team-access-card";
//   <TeamAccessCard email={profileEmail} />
//
// Показывает кнопку "Запросити учасника" (только если подписка team_alerts
// активна — иначе апсейл-подсказка со ссылкой на /#pricing) и список
// подключённых участников. После генерации ссылки — кнопка "Копіювати" с
// коротким превью ссылки, при клике меняется на "Скопійовано ✓" на 2 сек
// вместо того, чтобы печатать участнику полный код целиком.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { X, Copy, Check } from "lucide-react";
import { useLanguage } from "@/lib/translations";

type Member = { id: string; telegram_username: string | null; role: string; created_at: string };

// Оставляем начало и конец ссылки, скрываем середину токена —
// человеку не нужно видеть сам код, только подтверждение, что ссылка живая.
function truncateUrl(url: string): string {
  const marker = "?start=";
  const idx = url.indexOf(marker);
  if (idx === -1) return url;
  const base = url.slice(0, idx + marker.length);
  const token = url.slice(idx + marker.length);
  if (token.length <= 10) return url;
  return `${base}${token.slice(0, 6)}…${token.slice(-4)}`;
}

export function TeamAccessCard({ email }: { email: string }) {
  const { language } = useLanguage();
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Храним КОД ошибки, а не готовый переведённый текст — иначе при смене
  // языка после неудачного клика сообщение оставалось на том языке, на
  // котором было в момент ошибки, а не на текущем языке интерфейса.
  const [errorCode, setErrorCode] = useState<"no_active_subscription" | "generic" | null>(null);
  const [copied, setCopied] = useState(false);

  const tr = {
    title:
      language === "UA" ? "Доступ для команди" : language === "DE" ? "Team-Zugriff" : "Team access",
    desc:
      language === "UA"
        ? "Запросіть колег отримувати бізнес-сповіщення в Telegram"
        : language === "DE"
        ? "Laden Sie Kollegen ein, Geschäftswarnungen in Telegram zu erhalten"
        : "Invite teammates to receive business alerts in Telegram",
    invite: language === "UA" ? "Запросити" : language === "DE" ? "Einladen" : "Invite",
    copyLink: language === "UA" ? "Копіювати" : language === "DE" ? "Kopieren" : "Copy",
    copied: language === "UA" ? "Скопійовано" : language === "DE" ? "Kopiert" : "Copied",
    revoke: language === "UA" ? "Відкликати доступ" : language === "DE" ? "Zugriff widerrufen" : "Revoke access",
    needsSub:
      language === "UA"
        ? "Спочатку підключіть послугу «Сповіщення для команди»"
        : language === "DE"
        ? "Zuerst den Zusatzdienst „Team-Benachrichtigungen“ aktivieren"
        : "Connect the \"Team alerts\" add-on first",
    genericError:
      language === "UA" ? "Сталася помилка" : language === "DE" ? "Ein Fehler ist aufgetreten" : "Something went wrong",
  };

  const loadMembers = async () => {
    try {
      const res = await fetch(`/api/team/members?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      setMembers(data.members || []);
    } catch (e) {
      console.error("Failed to load team members", e);
    }
  };

  useEffect(() => {
    if (email) loadMembers();
  }, [email]);

  const handleInvite = async () => {
    setLoading(true);
    setErrorCode(null);
    setInviteUrl(null);
    setCopied(false);
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorCode(data.error === "no_active_subscription" ? "no_active_subscription" : "generic");
        return;
      }
      setInviteUrl(data.url);
    } catch (e) {
      console.error("Failed to create team invite", e);
      setErrorCode("generic");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy invite link", e);
    }
  };

  const handleRevoke = async (memberId: string) => {
    try {
      await fetch("/api/team/members", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, memberId }),
      });
      loadMembers();
    } catch (e) {
      console.error("Failed to revoke team member", e);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-foreground">{tr.title}</p>
        <p className="text-xs text-muted-foreground">{tr.desc}</p>

        {errorCode && (
          <p className="text-xs text-red-400 mt-1.5">
            {errorCode === "no_active_subscription" ? tr.needsSub : tr.genericError}
          </p>
        )}

        {members.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {members.map((m) => (
              <span
                key={m.id}
                className="inline-flex items-center gap-1 text-xs bg-secondary/60 text-muted-foreground rounded-full pl-2.5 pr-1 py-0.5"
              >
                {m.telegram_username ? `@${m.telegram_username}` : tr.noUsername}
                <button
                  onClick={() => handleRevoke(m.id)}
                  aria-label={tr.revoke}
                  className="hover:text-red-400 p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {inviteUrl && (
          <p className="text-[11px] text-muted-foreground/70 mt-1.5 font-mono truncate">
            {truncateUrl(inviteUrl)}
          </p>
        )}
      </div>

      <div className="shrink-0">
        {inviteUrl ? (
          <Button variant="outline" size="sm" onClick={handleCopy}>
            {copied ? (
              <>
                <Check className="w-4 h-4 mr-1.5 text-green-400" /> {tr.copied}
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 mr-1.5" /> {tr.copyLink}
              </>
            )}
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={handleInvite} disabled={loading}>
            {loading ? "..." : tr.invite}
          </Button>
        )}
      </div>
    </div>
  );
}