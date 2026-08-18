import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient'; // используйте ваш существующий клиент
import { useTranslations, SUPPORTED_LOCALES } from '../lib/i18n';
import { buildTransakUrl } from '../lib/transak';

// order — объект, который вернул supabase.rpc('reserve_order', {...})
// initialLocale — 'uk' | 'en' | 'ru', берётся из локали сайта
// onClose(result) — result: { success: true } | { retry: true } | undefined
export default function CryptoPaymentModal({ order, initialLocale = 'en', onClose }) {
  const [locale, setLocale] = useState(initialLocale);
  const t = useTranslations(locale, 'payment_modal');
  const [status, setStatus] = useState(order.status);
  const [copied, setCopied] = useState(null);

  const exactAmount = (order.exact_amount_cents / 100).toFixed(2);
  const isExpired = status === 'expired';

  useEffect(() => {
    const channel = supabase
      .channel(`order-${order.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${order.id}` },
        (payload) => setStatus(payload.new.status)
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [order.id]);

  useEffect(() => {
    if (status === 'success') onClose?.({ success: true });
  }, [status]);

  async function handleCopy(field, value) {
    await navigator.clipboard.writeText(String(value));
    setCopied(field);
    setTimeout(() => setCopied(null), 1500);
  }

  const transakUrl = useMemo(
    () =>
      buildTransakUrl({
        apiKey: process.env.NEXT_PUBLIC_TRANSAK_API_KEY,
        environment: 'STAGING',
        fiatCurrency: 'USD',
        cryptoCurrencyCode: order.token,
        network: order.chain,
        fiatAmount: exactAmount,
        walletAddress: order.receiving_wallet,
        disableWalletAddressForm: true,
        partnerOrderId: order.id,
        themeColor: '0F172A',
      }),
    [order.id, exactAmount]
  );

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>{t('title')}</h2>

          <div className="locale-switcher">
            {SUPPORTED_LOCALES.map((code) => (
              <button
                key={code}
                className={code === locale ? 'active' : ''}
                onClick={() => setLocale(code)}
                type="button"
              >
                {code.toUpperCase()}
              </button>
            ))}
          </div>

          <button className="close-button" onClick={() => onClose?.()} type="button">
            ×
          </button>
        </div>

        <p className="subtitle">{t('subtitle')}</p>

        <div className="field">
          <label>{t('amount_label')}</label>
          <div className="value-row">
            <span className="value mono">
              {exactAmount} {order.token}
            </span>
            <button type="button" onClick={() => handleCopy('amount', exactAmount)}>
              {copied === 'amount' ? '✓' : 'copy'}
            </button>
          </div>
        </div>
        <p className="warning">{t('unique_warning')}</p>

        <div className="field">
          <label>{t('address_label')}</label>
          <div className="value-row">
            <span className="value mono">{order.receiving_wallet}</span>
            <button type="button" onClick={() => handleCopy('address', order.receiving_wallet)}>
              {copied === 'address' ? '✓' : 'copy'}
            </button>
          </div>
        </div>

        {!isExpired ? (
          <iframe
            src={transakUrl}
            allow="camera;microphone;payment"
            style={{ height: 600, width: '100%', border: 'none', marginTop: 16 }}
            title="Transak"
          />
        ) : (
          <div className="expired-state">
            <p>{t('expired')}</p>
            <button type="button" onClick={() => onClose?.({ retry: true })}>
              {t('retry')}
            </button>
          </div>
        )}

        {!isExpired && <p className="status-line">{t('waiting')}</p>}
      </div>
    </div>
  );
}