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

type Category = "revenue" | "marketing" | "inventory" | "technical";

// Тримати в синку з lib/alerts.mjs (ALERT_CATEGORIES) — бекенд є джерелом
// істини для валідації, тут лише порядок і підписи для UI.
const ALL_CATEGORIES: Category[] = ["revenue", "marketing", "inventory", "technical"];

type Member = {
  id: string;
  telegram_id: number | null;
  telegram_username: string | null;
  role: string;
  categories?: Category[];
  created_at: string;
};

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
    categoriesLabel:
      language === "UA" ? "Які сповіщення отримує" : language === "DE" ? "Erhält Benachrichtigungen für" : "Receives alerts for",
    categoryNames: {
      revenue: language === "UA" ? "Виручка" : language === "DE" ? "Umsatz" : "Revenue",
      marketing: language === "UA" ? "Реклама" : language === "DE" ? "Marketing" : "Marketing",
      inventory: language === "UA" ? "Товари/залишки" : language === "DE" ? "Lagerbestand" : "Inventory",
      technical: language === "UA" ? "Технічні збої" : language === "DE" ? "Technische Störungen" : "Technical",
    } as Record<Category, string>,
    inviteCategoriesHint:
      language === "UA"
        ? "Оберіть, які сповіщення побачить людина за цим посиланням:"
        : language === "DE"
        ? "Wählen Sie, welche Benachrichtigungen diese Person über diesen Link sieht:"
        : "Choose which alerts the person joining via this link will see:",
    savedCategories: language === "UA" ? "Збережено" : language === "DE" ? "Gespeichert" : "Saved",
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

// Переиспользуемые чипы категорий: toggleable, disabled — только чтение
// (используется при показе категорий существующего участника до сохранения).
function CategoryToggles({
  selected,
  onToggle,
  categoryNames,
  pending,
}: {
  selected: Category[];
  onToggle: (category: Category) => void;
  categoryNames: Record<Category, string>;
  pending?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ALL_CATEGORIES.map((cat) => {
        const active = selected.includes(cat);
        return (
          <button
            key={cat}
            type="button"
            disabled={pending}
            onClick={() => onToggle(cat)}
            className={`text-[11px] px-2 py-1 rounded-full border transition-colors disabled:opacity-50 ${
              active
                ? "bg-primary/15 border-primary/40 text-primary"
                : "bg-transparent border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {categoryNames[cat]}
          </button>
        );
      })}
    </div>
  );
}

function TeamManageModal({
  open,
  onOpenChange,
  members,
  language,
  onRevoke,
  onUpdateCategories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: Member[];
  language: string;
  onRevoke: (memberId: string) => void;
  onUpdateCategories: (memberId: string, categories: Category[]) => Promise<void>;
}) {
  const tr = useTeamTranslations(language);
  // Отдельный per-member "сохраняется" индикатор — чтобы клик по одному
  // участнику не блокировал чекбоксы у остальных, пока летит запрос.
  const [savingId, setSavingId] = useState<string | null>(null);
  const [justSavedId, setJustSavedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnScroll = () => onOpenChange(false);
    window.addEventListener("wheel", closeOnScroll, { passive: true });
    window.addEventListener("touchmove", closeOnScroll, { passive: true });
    return () => {
      window.removeEventListener("wheel", closeOnScroll);
      window.removeEventListener("touchmove", closeOnScroll);
    };
  }, [open, onOpenChange]);

  const handleToggle = async (member: Member, category: Category) => {
    const current = member.categories && member.categories.length ? member.categories : ALL_CATEGORIES;
    const next = current.includes(category) ? current.filter((c) => c !== category) : [...current, category];
    // Не даём снять последнюю галочку — иначе человек перестанет получать
    // вообще любые уведомления незаметно для владельца (это и есть "отключить",
    // для чего есть отдельная кнопка "Відкликати доступ").
    if (next.length === 0) return;
    setSavingId(member.id);
    try {
      await onUpdateCategories(member.id, next);
      setJustSavedId(member.id);
      setTimeout(() => setJustSavedId((id) => (id === member.id ? null : id)), 1500);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
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
          <div className="max-h-96 overflow-y-auto -mx-1 px-1 space-y-3">
            {members.map((m) => {
              const displayName = m.telegram_id
                ? `Telegram ID: ${m.telegram_id}`
                : m.telegram_username
                ? `@${m.telegram_username}`
                : formatJoinedDate(m.created_at, language);
              const selected = m.categories && m.categories.length ? m.categories : ALL_CATEGORIES;
              return (
                <div key={m.id} className="rounded-lg border border-border/50 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm text-foreground">{displayName}</p>
                      <p className="text-xs text-muted-foreground">
                        {tr.joinedOn}: {formatJoinedDate(m.created_at, language)}
                      </p>
                    </div>
                    <button
                      onClick={() => onRevoke(m.id)}
                      aria-label={tr.revoke}
                      title={tr.revoke}
                      className="text-muted-foreground hover:text-red-400 p-1 shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-2 mb-1">
                    {tr.categoriesLabel}
                    {justSavedId === m.id && <span className="text-primary ml-1.5">✓ {tr.savedCategories}</span>}
                  </p>
                  <CategoryToggles
                    selected={selected}
                    onToggle={(cat) => handleToggle(m, cat)}
                    categoryNames={tr.categoryNames}
                    pending={savingId === m.id}
                  />
                </div>
              );
            })}
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
  // Категорії для НАСТУПНОГО запрошення, яке власник ще не створив. За
  // замовчуванням — усі, щоб не змінювати звичну поведінку "просто натиснув
  // Запросити" для тих, хто категоріями не переймається.
  const [inviteCategories, setInviteCategories] = useState<Category[]>(ALL_CATEGORIES);

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
        body: JSON.stringify({ email, categories: inviteCategories }),
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

  // Оптимістично оновлюємо локальний стан одразу — модалка не блимає, поки
  // йде запит, а loadMembers() підтягне справжній стан з бекенду як
  // підтвердження (і відкотить назад, якщо PATCH все ж не пройшов).
  const handleUpdateCategories = async (memberId: string, categories: Category[]) => {
    setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, categories } : m)));
    try {
      const res = await fetch("/api/team/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, memberId, categories }),
      });
      if (!res.ok) throw new Error("PATCH failed");
    } catch (e) {
      console.error("Failed to update member categories", e);
      loadMembers(); // откатываем оптимистичное изменение к реальному состоянию
    }
  };

  const toggleInviteCategory = (category: Category) => {
    setInviteCategories((prev) => {
      const next = prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category];
      return next.length ? next : prev; // хоча б одна категорія завжди лишається обраною
    });
  };

  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-foreground">{tr.title}</p>
          <p className="text-xs text-muted-foreground">{tr.desc}</p>
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
      </div>

      {errorCode && (
        <p className="text-xs text-red-400 mt-1.5">
          {errorCode === "no_active_subscription" ? tr.needsSub : tr.genericError}
        </p>
      )}

      {!inviteUrl && (
        <div className="mt-2 w-full">
          <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2.5">
            <p className="text-[11px] text-muted-foreground shrink-0">{tr.inviteCategoriesHint}</p>
            <CategoryToggles
              selected={inviteCategories}
              onToggle={toggleInviteCategory}
              categoryNames={tr.categoryNames}
            />
          </div>
        </div>
      )}

      {inviteUrl && (
        <p className="text-[11px] text-muted-foreground/70 mt-1.5 font-mono truncate">
          {truncateUrl(inviteUrl)}
        </p>
      )}

      {members.length > 0 && (
        <button
          onClick={() => setManageOpen(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mt-2 transition-colors"
        >
          <Users className="w-3.5 h-3.5" />
          <span className="underline underline-offset-2">{tr.manage}</span>
        </button>
      )}

      <TeamManageModal
        open={manageOpen}
        onOpenChange={setManageOpen}
        members={members}
        language={language}
        onRevoke={handleRevoke}
        onUpdateCategories={handleUpdateCategories}
      />
    </div>
  );
}