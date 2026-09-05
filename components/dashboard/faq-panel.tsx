"use client";

// components/dashboard/faq-panel.tsx
//
// Рендерит контент из lib/faq-content.ts (todo п.9). ВАЖНО: до этого файл
// с контентом существовал, но нигде не импортировался — ни один компонент
// на него не ссылался (проверено: grep по app/ и components/ ничего не
// находил, кроме самого lib/faq-content.ts). Статьи были только "на
// бумаге", пользователь физически не мог их увидеть. Этот компонент —
// собственно тот "раздел в дашборде", который планировался в комментарии
// к faq-content.ts.
//
// Подключается в app/dashboard/page.tsx как activeView === "faq":
//   import { FaqPanel } from "@/components/dashboard/faq-panel";
//   {activeView === "faq" && <FaqPanel language={language} initialSlug={faqInitialSlug} />}
//
// initialSlug — для перехода по ссылке "Как это исправить?" из карточки
// риска с category === "integration" (см. alertTypeToCategory в page.tsx):
// открывает сразу статью sync-errors, а не всю категорию списком.

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, HelpCircle, Search } from "lucide-react";
import {
  FAQ_ARTICLES,
  FAQ_CATEGORIES,
  type FaqCategoryId,
} from "@/lib/faq-content";
import type { Language } from "@/lib/translations";

interface FaqPanelProps {
  language: Language;
  initialSlug?: string | null;
}

export function FaqPanel({ language, initialSlug }: FaqPanelProps) {
  const [activeCategory, setActiveCategory] = useState<FaqCategoryId | "all">("all");
  const [query, setQuery] = useState("");
  const [openSlug, setOpenSlug] = useState<string | null>(initialSlug ?? null);

  // Переход по ссылке из карточки риска может произойти, когда FaqPanel уже
  // смонтирован (пользователь ранее открывал FAQ и просто вернулся на неё) —
  // initialSlug как проп сработает только при первом монтировании, поэтому
  // отдельно следим за его изменением.
  useEffect(() => {
    if (initialSlug) {
      setOpenSlug(initialSlug);
      const article = FAQ_ARTICLES.find((a) => a.slug === initialSlug);
      if (article) setActiveCategory(article.category);
    }
  }, [initialSlug]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FAQ_ARTICLES.filter((a) => {
      if (activeCategory !== "all" && a.category !== activeCategory) return false;
      if (!q) return true;
      return (
        a.question[language].toLowerCase().includes(q) ||
        a.answer[language].toLowerCase().includes(q)
      );
    });
  }, [activeCategory, query, language]);

  const placeholder =
    language === "UA" ? "Пошук у довідці..." : language === "DE" ? "Hilfe durchsuchen..." : "Search help articles...";
  const allLabel = language === "UA" ? "Усі" : language === "DE" ? "Alle" : "All";
  const emptyLabel =
    language === "UA"
      ? "Нічого не знайдено за цим запитом."
      : language === "DE"
      ? "Für diese Suche wurde nichts gefunden."
      : "Nothing matches that search.";

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-secondary border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-foreground"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActiveCategory("all")}
          className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
            activeCategory === "all" ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground hover:text-foreground"
          }`}
        >
          {allLabel}
        </button>
        {FAQ_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
              activeCategory === cat.id ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            {cat.label[language]}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.map((article) => {
          const isOpen = openSlug === article.slug;
          return (
            <div key={article.slug} className="bg-card rounded-xl border border-border overflow-hidden">
              <button
                onClick={() => setOpenSlug(isOpen ? null : article.slug)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span className="font-medium text-sm text-foreground">{article.question[language]}</span>
                <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </button>
              {isOpen && (
                <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                  {article.answer[language].split("\n\n").map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <HelpCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">{emptyLabel}</p>
          </div>
        )}
      </div>
    </div>
  );
}