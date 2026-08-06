"use client";

import { LanguageProvider } from "@/lib/translations";
import { CurrencyProvider } from "@/lib/currency";

export function ClientProvider({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      <CurrencyProvider>{children}</CurrencyProvider>
    </LanguageProvider>
  );
}