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
// ІСТОРІЯ: раніше тут прямо в рядку настройок рендерився весь список
// учасників — кожен окремим "чіпом" з @username і хрестиком поруч. Для 2-3
// людей це виглядало нормально, але ліміт на бекенді (TEAM_MEMBER_LIMIT в
// app/api/team/invite/route.js) — 10, і навіть 10 чіпів у вузькій колонці
// настройок перетворювались на нечитабельну стіну. Плюс для учасника без
// telegram_username треба було щось показувати замість імені — раніше це
// був текст "Без username", який свідомо прибрали (виглядає як помилка,
// а не як нормальний стан). Тепер: в самій картці настройок — тільки
// компактний підсумок ("Підключено X із N") і кнопка "Керувати", яка
// відкриває модалку з нормальною таблицею. Учасника без username там
// підписуємо датою підключення — це завжди осмислена інформація, на
// відміну від порожнього "Без username".

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Users, X } from "lucide-react";
import { useLanguage } from "@/lib/translations";

type Member = { id: string; telegram_username: string | null; role: string; created_at: string };

// Тримаємо в одному місці — щоб не розійшлось з бекендом (app/api/team/invite/route.js).
// Це лише для тексту "X із N" на фронті; реальний ліміт перевіряється на сервері.
const TEAM_MEMBER_LIMIT = 10;

function formatJoinedDate(iso: string, language: string): string {
  try {
    const locale = language === "UA" ? "uk-UA" : language === "DE" ? "de-DE" : "en-US";
    return new Date(iso).toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

function useTeamTranslations(language: string) {
  return {
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
    manage: language === "UA" ? "Керувати" : language === "DE" ? "Verwalten" : "Manage",
    connectedCount: (n: number) =>
      language === "UA"
        ? `Підключено ${n} із ${TEAM_MEMBER_LIMIT}`
        : language === "DE"
        ? `${n} von ${TEAM_MEMBER_LIMIT} verbunden`
        : `${n} of ${TEAM_MEMBER_LIMIT} connected`,
    modalTitle: language === "UA" ? "Учасники команди" : language === "DE" ? "Teammitglieder" : "Team members",
    modalDesc:
      language === "UA"
        ? "Тут ви бачите всіх, хто отримує бізнес-сповіщення у Telegram, і можете відкликати доступ."
        : language === "DE"
        ? "Hier sehen Sie alle, die Geschäftsbenachrichtigungen in Telegram erhalten, und können den Zugriff widerrufen."
        : "Everyone receiving business alerts in Telegram, with the option to revoke access.",
    joinedOn: language === "UA" ? "Приєднався" : language === "DE" ? "Beigetreten am" : "Joined",
    revoke: language === "UA" ? "Відкликати доступ" : language === "DE" ? "Zugriff widerrufen" : "Revoke access",
    empty:
      language === "UA" ? "Ще ніхто не приєднався" : language === "DE" ? "Noch niemand beigetreten" : "Nobody has joined yet",
    needsSub:
      language === "UA"
        ? "Спочатку підключіть послугу «Сповіщення для команди»"
        : language === "DE"
        ? "Zuerst den Zusatzdienst „Team-Benachrichtigungen“ aktivieren"
        : "Connect the \"Team alerts\" add-on first",
    genericError:
      language === "UA" ? "Сталася помилка" : language === "DE" ? "Ein Fehler ist aufgetreten" : "Something went wrong",
    close: language === "UA" ? "Закрити" : language === "DE" ? "Schließen" : "Close",
  };
}

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

function TeamManageModal({
  open,
  onOpenChange,
  members,
  language,
  onRevoke,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: Member[];
  language: string;
  onRevoke: (memberId: string) => void;
}) {
  const tr = useTeamTranslations(language);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> {tr.modalTitle}
          </DialogTitle>
          <DialogDescription>{tr.modalDesc}</DialogDescription>
        </DialogHeader>

        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">{tr.empty}</p>
        ) : (
          // max-h + overflow, а не пагінація: TEAM_MEMBER_LIMIT = 10, список
          // ніколи не виросте настільки, щоб пагінація дала реальну користь —
          // прокрутки в межах модалки достатньо.
          <div className="max-h-80 overflow-y-auto -mx-1 px-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground uppercase tracking-wider border-b border-border">
                  <th className="font-medium pb-2 pr-2">{tr.title}</th>
                  <th className="font-medium pb-2 pr-2">{tr.joinedOn}</th>
                  <th className="font-medium pb-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-b border-border/50 last:border-0">
                    <td className="py-2.5 pr-2 text-foreground">
                      {m.telegram_username ? `@${m.telegram_username}` : formatJoinedDate(m.created_at, language)}
                    </td>
                    <td className="py-2.5 pr-2 text-muted-foreground">{formatJoinedDate(m.created_at, language)}</td>
                    <td className="py-2.5">
                      <button
                        onClick={() => onRevoke(m.id)}
                        aria-label={tr.revoke}
                        title={tr.revoke}
                        className="text-muted-foreground hover:text-red-400 p-1"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function TeamAccessCard({ email }: { email: string }) {
  const { language } = useLanguage();
  const tr = useTeamTranslations(language);
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  // Храним КОД ошибки, а не готовый переведённый текст — иначе при смене
  // языка после неудачного клика сообщение оставалось на том языке, на
  // котором было в момент ошибки, а не на текущем языке интерфейса.
  const [errorCode, setErrorCode] = useState<"no_active_subscription" | "generic" | null>(null);
  const [copied, setCopied] = useState(false);

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
          <button
            onClick={() => setManageOpen(true)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mt-2 transition-colors"
          >
            <Users className="w-3.5 h-3.5" />
            {tr.connectedCount(members.length)}
            <span className="underline underline-offset-2">{tr.manage}</span>
          </button>
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
            {copied ? tr.copied : tr.copyLink}
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={handleInvite} disabled={loading}>
            {loading ? "..." : tr.invite}
          </Button>
        )}
      </div>

      <TeamManageModal
        open={manageOpen}
        onOpenChange={setManageOpen}
        members={members}
        language={language}
        onRevoke={handleRevoke}
      />
    </div>
  );
}