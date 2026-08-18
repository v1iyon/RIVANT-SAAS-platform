"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useOrderStatus } from "@/lib/use-order-status";
import { Copy, Check, X } from "lucide-react";

interface CryptoCheckoutModalProps {
  orderId: string;
  amountToSend: string;
  token: string;
  chain: string;
  receivingWallet: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function CryptoCheckoutModal({
  orderId,
  amountToSend,
  token,
  chain,
  receivingWallet,
  onClose,
  onSuccess,
}: CryptoCheckoutModalProps) {
  const supabase = createClient();
  const { status } = useOrderStatus(orderId, supabase);
  const [copiedAmount, setCopiedAmount] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);

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

        <h3 className="mb-1 text-xl font-bold text-white">Оплата криптовалютой</h3>
        <p className="mb-6 text-sm text-slate-400">
          Сеть {chain}, токен {token}. Переведите ТОЧНУЮ сумму, включая копейки — иначе
          система не сможет автоматически найти ваш платёж.
        </p>

        {isExpired ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
            Время на оплату истекло. Закройте окно и начните заново.
          </div>
        ) : (
          <>
            <div className="mb-4">
              <label className="mb-1 block text-xs text-slate-500">Сумма к переводу</label>
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
              <p className="mt-1 text-xs text-amber-400">
                Сумма уникальна для этого заказа — не округляйте её.
              </p>
            </div>

            <div className="mb-6">
              <label className="mb-1 block text-xs text-slate-500">Адрес получателя</label>
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

            <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
              Ожидаем платёж — окно закроется автоматически
            </div>
          </>
        )}
      </div>
    </div>
  );
}
