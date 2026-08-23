"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useOrderStatus } from "@/lib/use-order-status";
import { Copy, Check, X } from "lucide-react";

type Locale = "de" | "en" | "uk";

const TEXT: Record<Locale, {
  title: string;
  subtitle: (chain: string, token: string) => string;
  amountLabel: string;
  addressLabel: string;
  uniqueWarning: string;
  waiting: string;
  expired: string;
}> = {
  de: {
    title: "Zahlung mit Kryptowährung",
    subtitle: (chain, token) =>
      `${chain}-Netzwerk, ${token}-Token. Überweisen Sie den EXAKTEN Betrag inklusive Cent — sonst kann das System Ihre Zahlung nicht automatisch finden.`,
    amountLabel: "Zu überweisender Betrag",
    addressLabel: "Empfängeradresse",
    uniqueWarning: "Dieser Betrag ist eindeutig für diese Bestellung — runden Sie ihn nicht.",
    waiting: "Zahlung wird erwartet — dieses Fenster schließt sich automatisch",
    expired: "Die Zahlungsfrist ist abgelaufen. Schließen Sie das Fenster und beginnen Sie erneut.",
  },
  en: {
    title: "Pay with crypto",
    subtitle: (chain, token) =>
      `${chain} network, ${token} token. Send the EXACT amount, including cents — otherwise the system won't be able to find your payment automatically.`,
    amountLabel: "Amount to send",
    addressLabel: "Receiving address",
    uniqueWarning: "This amount is unique to your order — don't round it.",
    waiting: "Waiting for payment — this window will close automatically",
    expired: "Payment window expired. Close this and start again.",
  },
  uk: {
    title: "Оплата криптовалютою",
    subtitle: (chain, token) =>
      `Мережа ${chain}, токен ${token}. Переведіть ТОЧНУ суму, включно з копійками — інакше система не зможе автоматично знайти ваш платіж.`,
    amountLabel: "Сума до переказу",
    addressLabel: "Адреса отримувача",
    uniqueWarning: "Сума унікальна для цього замовлення — не округлюйте її.",
    waiting: "Очікуємо платіж — вікно закриється автоматично",
    expired: "Час на оплату минув. Закрийте вікно і почніть знову.",
  },
};

// Собирает ссылку для iframe Transak.
//
// Environment больше не захардкожен: берём из
// NEXT_PUBLIC_TRANSAK_ENVIRONMENT. По умолчанию — "PRODUCTION" (безопасный
// дефолт для боевого запуска: если переменную забыли выставить, лучше
// случайно получить прод, чем случайно застрять на staging и не увидеть
// реальных платежей). Явно укажи "STAGING" в .env для локальной разработки:
//
//   NEXT_PUBLIC_TRANSAK_ENVIRONMENT=STAGING   # локально / preview
//   NEXT_PUBLIC_TRANSAK_ENVIRONMENT=PRODUCTION # прод (или просто не задавать)
function buildTransakUrl(opts: {
  fiatCurrency: string;
  cryptoCurrencyCode: string;
  network: string;
  fiatAmount: string;
  walletAddress: string;
  partnerOrderId: string;
}) {
  const environment =
    process.env.NEXT_PUBLIC_TRANSAK_ENVIRONMENT === "STAGING" ? "STAGING" : "PRODUCTION";

  const base =
    environment === "PRODUCTION"
      ? "https://global.transak.com"
      : "https://global-stg.transak.com";

  const params = new URLSearchParams({
    apiKey: process.env.NEXT_PUBLIC_TRANSAK_API_KEY ?? "",
    fiatCurrency: opts.fiatCurrency,
    cryptoCurrencyCode: opts.cryptoCurrencyCode,
    network: opts.network,
    defaultFiatAmount: opts.fiatAmount,
    walletAddress: opts.walletAddress,
    disableWalletAddressForm: "true",
    partnerOrderId: opts.partnerOrderId,
    themeColor: "0A0A0A",
  });

  return `${base}?${params.toString()}`;
}

interface CryptoCheckoutModalProps {
  orderId: string;
  amountToSend: string;
  token: string;
  chain: string;
  receivingWallet: string;
  locale?: Locale; // 'de' | 'en' | 'uk', по умолчанию 'uk' (язык сайта)
  onClose: () => void;
  onSuccess: () => void;
}

export function CryptoCheckoutModal({
  orderId,
  amountToSend,
  token,
  chain,
  receivingWallet,
  locale: initialLocale = "uk",
  onClose,
  onSuccess,
}: CryptoCheckoutModalProps) {
  const supabase = createClient();
  const { status } = useOrderStatus(orderId, supabase);
  const [copiedAmount, setCopiedAmount] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [locale, setLocale] = useState<Locale>(initialLocale);

  const t = TEXT[locale];

  useEffect(() => {
    if (status === "success") onSuccess();
  }, [status, onSuccess]);

  const copy = async (text: string, which: "amount" | "address") => {
    await navigator.clipboard.writeText(text);
    if (which === "amount") {
      setCopiedAmount(true);
      setTimeout(() => setCopiedAmount(false), 2000);
    } else {
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    }
  };

  const isExpired = status === "expired";

  const transakUrl = useMemo(
    () =>
      buildTransakUrl({
        fiatCurrency: "USD",
        cryptoCurrencyCode: token,
        network: chain,
        fiatAmount: amountToSend,
        walletAddress: receivingWallet,
        partnerOrderId: orderId,
      }),
    [token, chain, amountToSend, receivingWallet, orderId]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#0A0A0A] p-6">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-slate-400 hover:text-white"
          aria-label="Закрыть"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="mb-1 flex items-center justify-between pr-8">
          <h3 className="text-xl font-bold text-white">{t.title}</h3>
          <div className="flex gap-1">
            {(["uk", "en", "de"] as Locale[]).map((code) => (
              <button
                key={code}
                onClick={() => setLocale(code)}
                className={`rounded px-2 py-1 text-xs font-semibold ${
                  code === locale
                    ? "bg-white/15 text-white"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {code.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <p className="mb-6 text-sm text-slate-400">{t.subtitle(chain, token)}</p>

        {isExpired ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
            {t.expired}
          </div>
        ) : (
          <>
            <div className="mb-4">
              <label className="mb-1 block text-xs text-slate-500">{t.amountLabel}</label>
              <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3">
                <span className="font-mono text-lg font-bold text-white">
                  {amountToSend} {token}
                </span>
                <button
                  onClick={() => copy(amountToSend, "amount")}
                  className="text-slate-400 hover:text-white"
                  aria-label="Скопировать сумму"
                >
                  {copiedAmount ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <p className="mt-1 text-xs text-amber-400">{t.uniqueWarning}</p>
            </div>

            <div className="mb-4">
              <label className="mb-1 block text-xs text-slate-500">{t.addressLabel}</label>
              <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3">
                <span className="truncate font-mono text-sm text-white">{receivingWallet}</span>
                <button
                  onClick={() => copy(receivingWallet, "address")}
                  className="ml-2 shrink-0 text-slate-400 hover:text-white"
                  aria-label="Скопировать адрес"
                >
                  {copiedAddress ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <iframe
              src={transakUrl}
              allow="camera;microphone;payment"
              className="mb-4 h-[500px] w-full rounded-lg border border-white/10"
              title="Transak"
            />

            <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
              {t.waiting}
            </div>
          </>
        )}
      </div>
    </div>
  );
}