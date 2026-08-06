"use client";

// lib/currency.tsx
//
// Переключатель валюты для тарифов (USD/EUR) — устроен так же, как
// LanguageProvider в lib/translations.tsx: React-контекст + localStorage,
// чтобы выбор сохранялся между визитами независимо от языка интерфейса
// (человек может читать сайт на UA, а платить хочет видеть в EUR).

import { createContext, useContext, useState, ReactNode, useEffect, useCallback } from "react";

export type Currency = "USD" | "EUR";

// Фиксированный курс конвертации (не тянем внешний FX API ради пары тарифных
// строк — курс редко меняет "психологическую" цену тарифа). Поправить здесь,
// если курс сильно уйдёт.
const USD_TO_EUR_RATE = 0.92;

const CURRENCY_SYMBOL: Record<Currency, string> = {
  USD: "$",
  EUR: "€",
};

interface CurrencyContextType {
  currency: Currency;
  setCurrency: (c: Currency) => void;
  // Переводит цену в USD (как она задана в коде тарифов) в выбранную валюту
  // и красиво форматирует со знаком валюты: formatPrice(99) -> "$99" или "€91".
  formatPrice: (usdAmount: number) => string;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>("USD");

  useEffect(() => {
    const saved = localStorage.getItem("preferredCurrency") as Currency;
    if (saved === "USD" || saved === "EUR") {
      setCurrencyState(saved);
    }
  }, []);

  const setCurrency = useCallback((c: Currency) => {
    setCurrencyState(c);
    localStorage.setItem("preferredCurrency", c);
  }, []);

  const formatPrice = useCallback(
    (usdAmount: number) => {
      const amount = currency === "EUR" ? Math.round(usdAmount * USD_TO_EUR_RATE) : usdAmount;
      return `${CURRENCY_SYMBOL[currency]}${amount}`;
    },
    [currency]
  );

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, formatPrice }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error("useCurrency must be used within a CurrencyProvider");
  }
  return context;
}