"use client";

import { useEffect } from "react";
import { LanguageProvider, useLanguage } from "@/lib/translations";
import { CurrencyProvider } from "@/lib/currency";

// ISO 639-1 языковые теги для <html lang>. "UA" в проекте — это внутренний
// код языка интерфейса (Ukrainian), но правильный языковой тег для
// украинского — "uk" (UA как ISO 639-1 не существует — это код СТРАНЫ
// Украина, ISO 3166-1, а не языка).
const HTML_LANG: Record<string, string> = { EN: "en", UA: "uk", DE: "de" };

// Синхронизирует атрибут lang на <html> с выбранным языком интерфейса.
// Раньше он был захардкожен как lang="en" в app/layout.tsx независимо от
// того, выбрал ли человек UA/DE/EN — это портит доступность (скринридеры
// выбирают неправильное произношение для не-английского текста) и немного
// вредит SEO (поисковики хуже индексируют не-английский контент без
// корректного lang). Обновляется в useEffect при каждой смене языка —
// сам <html> рендерится в app/layout.tsx (серверный компонент, там языка
// пользователя ещё не видно), поэтому синхронизация возможна только здесь,
// на клиенте, после монтирования.
function HtmlLangSync() {
  const { language } = useLanguage();
  useEffect(() => {
    document.documentElement.lang = HTML_LANG[language] || "en";
  }, [language]);
  return null;
}

export function ClientProvider({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      <HtmlLangSync />
      <CurrencyProvider>{children}</CurrencyProvider>
    </LanguageProvider>
  );
}