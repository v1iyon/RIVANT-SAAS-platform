"use client";

import { useLanguage } from "@/lib/translations";

// FIX (аудит п.7): страница раньше вообще не использовала useLanguage.
const content = {
  EN: {
    title: "Refund Policy",
    updated: "Last updated: July 2026",
    s1heading: "1. Free Trial",
    s1: "Every new account receives a 14-day free trial with full access to RIVANT. No payment is taken during this period, so there is nothing to refund — you can evaluate the product risk-free before subscribing.",
    s2heading: "2. First Subscription Payment",
    s2: "If you are not satisfied with RIVANT after your first paid subscription payment, you may request a full refund within 7 days of that payment by contacting us through our contact form. This applies once per customer, to the first payment only.",
    s3heading: "3. Renewals & Subsequent Payments",
    s3: "Recurring monthly payments after your first billing cycle are non-refundable. You can cancel your subscription at any time to stop future renewals — your access will remain active until the end of the period you already paid for.",
    s4heading: "4. Plan Changes",
    s4: "If you upgrade your plan, the new price applies from your next billing cycle. Upgrades and downgrades do not generate a refund for the difference in the current period.",
    s5heading: "5. How to Request a Refund",
    s5: "Contact us through the contact form on our website with your account email and the reason for your request. Eligible refunds (see section 2) are processed via Paddle, our payment provider, within 5-10 business days.",
    s6heading: "6. Billing Disputes",
    s6: "If you believe you were charged in error, please contact us before initiating a chargeback with your bank — we're able to resolve most billing issues directly and faster this way.",
  },
  UA: {
    title: "Політика повернення коштів",
    updated: "Востаннє оновлено: липень 2026",
    s1heading: "1. Безкоштовний пробний період",
    s1: "Кожен новий обліковий запис отримує 14-денний безкоштовний пробний період з повним доступом до RIVANT. Оплата протягом цього періоду не стягується, тож повертати нічого — ви можете оцінити продукт без жодного ризику перед оформленням підписки.",
    s2heading: "2. Перший платіж за підпискою",
    s2: "Якщо ви незадоволені RIVANT після першого платного платежу за підпискою, ви можете запросити повне повернення коштів протягом 7 днів після цього платежу, звернувшись до нас через контактну форму. Це стосується лише першого платежу і застосовується один раз на клієнта.",
    s3heading: "3. Продовження підписки та наступні платежі",
    s3: "Регулярні щомісячні платежі після першого розрахункового періоду поверненню не підлягають. Ви можете скасувати підписку в будь-який момент, щоб зупинити майбутні списання — доступ залишиться активним до кінця вже оплаченого періоду.",
    s4heading: "4. Зміна тарифу",
    s4: "Якщо ви підвищуєте тариф, нова ціна застосовується з наступного розрахункового періоду. Підвищення та зниження тарифу не передбачають повернення різниці за поточний період.",
    s5heading: "5. Як запросити повернення коштів",
    s5: "Зверніться до нас через контактну форму на сайті, вказавши email вашого облікового запису та причину запиту. Прийнятні для повернення платежі (див. пункт 2) обробляються через Paddle, нашого платіжного провайдера, протягом 5-10 робочих днів.",
    s6heading: "6. Спірні платежі",
    s6: "Якщо ви вважаєте, що з вас списали кошти помилково, будь ласка, зв'яжіться з нами до ініціювання чарджбеку через банк — так ми зможемо вирішити більшість питань з оплатою напряму й швидше.",
  },
  DE: {
    title: "Rückerstattungsrichtlinie",
    updated: "Zuletzt aktualisiert: Juli 2026",
    s1heading: "1. Kostenlose Testphase",
    s1: "Jedes neue Konto erhält eine 14-tägige kostenlose Testphase mit vollem Zugang zu RIVANT. Während dieser Zeit wird keine Zahlung eingezogen, es gibt also nichts zu erstatten — Sie können das Produkt risikofrei testen, bevor Sie ein Abonnement abschließen.",
    s2heading: "2. Erste Abonnementzahlung",
    s2: "Wenn Sie nach Ihrer ersten kostenpflichtigen Abonnementzahlung mit RIVANT nicht zufrieden sind, können Sie innerhalb von 7 Tagen nach dieser Zahlung über unser Kontaktformular eine vollständige Rückerstattung beantragen. Dies gilt einmalig pro Kunde und nur für die erste Zahlung.",
    s3heading: "3. Verlängerungen und Folgezahlungen",
    s3: "Wiederkehrende monatliche Zahlungen nach Ihrem ersten Abrechnungszyklus sind nicht erstattungsfähig. Sie können Ihr Abonnement jederzeit kündigen, um künftige Verlängerungen zu stoppen — Ihr Zugang bleibt bis zum Ende des bereits bezahlten Zeitraums aktiv.",
    s4heading: "4. Tarifwechsel",
    s4: "Wenn Sie Ihren Tarif upgraden, gilt der neue Preis ab dem nächsten Abrechnungszyklus. Upgrades und Downgrades führen nicht zu einer Erstattung der Differenz für den aktuellen Zeitraum.",
    s5heading: "5. So beantragen Sie eine Rückerstattung",
    s5: "Kontaktieren Sie uns über das Kontaktformular auf unserer Website mit Ihrer Konto-E-Mail-Adresse und dem Grund für Ihre Anfrage. Berechtigte Rückerstattungen (siehe Abschnitt 2) werden über Paddle, unseren Zahlungsanbieter, innerhalb von 5-10 Werktagen abgewickelt.",
    s6heading: "6. Zahlungsstreitigkeiten",
    s6: "Wenn Sie glauben, fälschlicherweise belastet worden zu sein, kontaktieren Sie uns bitte, bevor Sie eine Rückbuchung bei Ihrer Bank veranlassen — so können wir die meisten Abrechnungsprobleme direkt und schneller lösen.",
  },
};

export default function RefundPolicyPage() {
  const { language } = useLanguage();
  const c = content[language];

  return (
    <div className="max-w-3xl mx-auto px-6 py-16 text-gray-300">
      <h1 className="text-3xl font-bold text-white mb-6">{c.title}</h1>
      <p className="text-sm text-gray-500 mb-8">{c.updated}</p>

      <div className="space-y-6 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold text-white">{c.s1heading}</h2>
        <p>{c.s1}</p>

        <h2 className="text-lg font-semibold text-white">{c.s2heading}</h2>
        <p>{c.s2}</p>

        <h2 className="text-lg font-semibold text-white">{c.s3heading}</h2>
        <p>{c.s3}</p>

        <h2 className="text-lg font-semibold text-white">{c.s4heading}</h2>
        <p>{c.s4}</p>

        <h2 className="text-lg font-semibold text-white">{c.s5heading}</h2>
        <p>{c.s5}</p>

        <h2 className="text-lg font-semibold text-white">{c.s6heading}</h2>
        <p>{c.s6}</p>
      </div>
    </div>
  );
}