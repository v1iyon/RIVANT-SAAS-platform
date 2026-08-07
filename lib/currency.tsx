"use client";

// lib/currency.tsx
//
// Переключатель валюты для тарифов (USD/EUR) — устроен так же, как
// LanguageProvider в lib/translations.tsx: React-контекст + localStorage,
// чтобы выбор сохранялся между визитами независимо от языка интерфейса
// (человек может читать сайт на UA, а платить хочет видеть в EUR).

import { createContext, useContext, useState, ReactNode, useEffect, useCallback, useMemo } from "react";

export type Currency = "USD" | "EUR";

// Общий курс конвертации для ЛЮБЫХ сумм, которых нет в PRICE_TABLE ниже —
// произвольные цифры в калькуляторе убытков, метрики в live-demo/кабинете
// и т.п. Внешний FX API не тянем: курс редко меняет "психологическую"
// картину, а для нескольких конкретных тарифных цен ниже заданы точные,
// вручную согласованные суммы (см. PRICE_TABLE).
export const USD_TO_EUR_RATE = 0.867;

const CURRENCY_SYMBOL: Record<Currency, string> = {
  USD: "$",
  EUR: "€",
};

// Точные цены тарифов/услуг в EUR — заданы вручную (не по курсу), потому
// что маркетинг хочет конкретные "круглые" числа, а не то, что выдаст
// формула. Ключ — цена в USD как она задана в коде компонентов.
// ВНИМАНИЕ: одна и та же цена в USD может стоить в EUR по-разному в
// зависимости от того, тариф это или разовая услуга (например, $299 у
// тарифа Growth и $299 у допуслуги Quarterly Audit конвертируются
// по-разному) — поэтому таблица разбита на "plans" и "addons".
const PLAN_PRICE_TABLE: Record<number, number> = {
  99: 86,
  299: 259,
  499: 432,
};

const ADDON_PRICE_TABLE: Record<number, number> = {
  199: 173,
  299: 275,
  29: 25,
};

// Общая конвертация по курсу — для сумм, которых нет в таблицах выше
// (метрики демо/личного кабинета, калькулятор убытков и т.д.)
export function convertAmount(usdAmount: number, currency: Currency): number {
  return currency === "EUR" ? usdAmount * USD_TO_EUR_RATE : usdAmount;
}

// Локализованное форматирование денежной суммы (с разделителями разрядов
// и правильным положением знака валюты под язык интерфейса) — используется
// там, где конвертированная сумма подставляется прямо в текст (например,
// в сгенерированные описания алертов демо-дашборда).
const LOCALE_MAP: Record<string, string> = { EN: "en-US", UA: "uk-UA", DE: "de-DE" };

export function formatLocaleCurrency(usdAmount: number, currency: Currency, lang: string = "EN"): string {
  const amount = convertAmount(usdAmount, currency);
  const locale = LOCALE_MAP[lang] || "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

interface CurrencyContextType {
  currency: Currency;
  setCurrency: (c: Currency) => void;
  symbol: string;
  // Переводит цену тарифа/допуслуги (как она задана в коде) в выбранную
  // валюту и красиво форматирует со знаком валюты: formatPrice(99) -> "$99"
  // или "€86". Если сумма есть в соответствующей таблице точных цен —
  // берётся она, иначе — общий курс USD_TO_EUR_RATE.
  formatPrice: (usdAmount: number, kind?: "plan" | "addon") => string;
  // Конвертирует и форматирует произвольную (не тарифную) сумму по общему
  // курсу — для метрик демо/кабинета, калькулятора убытков и т.п.
  formatAmount: (usdAmount: number, options?: Intl.NumberFormatOptions) => string;
  convert: (usdAmount: number) => number;
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

  const convert = useCallback((usdAmount: number) => convertAmount(usdAmount, currency), [currency]);

  const formatPrice = useCallback(
    (usdAmount: number, kind: "plan" | "addon" = "plan") => {
      if (currency !== "EUR") {
        return `${CURRENCY_SYMBOL.USD}${usdAmount}`;
      }
      const table = kind === "addon" ? ADDON_PRICE_TABLE : PLAN_PRICE_TABLE;
      const exact = table[usdAmount];
      const amount = exact !== undefined ? exact : Math.round(usdAmount * USD_TO_EUR_RATE);
      return `${CURRENCY_SYMBOL.EUR}${amount}`;
    },
    [currency]
  );

  const formatAmount = useCallback(
    (usdAmount: number, options?: Intl.NumberFormatOptions) => {
      const amount = convert(usdAmount);
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
        ...options,
      }).format(amount);
    },
    [currency, convert]
  );

  const value = useMemo(
    () => ({ currency, setCurrency, symbol: CURRENCY_SYMBOL[currency], formatPrice, formatAmount, convert }),
    [currency, setCurrency, formatPrice, formatAmount, convert]
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error("useCurrency must be used within a CurrencyProvider");
  }
  return context;
}