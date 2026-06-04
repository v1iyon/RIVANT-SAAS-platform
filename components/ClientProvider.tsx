"use client";

import { LanguageProvider } from "@/lib/translations";

export function ClientProvider({ children }: { children: React.ReactNode }) {
  return <LanguageProvider>{children}</LanguageProvider>;
}