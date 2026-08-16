"use client";

import { useLanguage } from "@/lib/translations";

// FIX (аудит п.7): страница раньше вообще не использовала useLanguage.
const content = {
  EN: {
    title: "Terms of Service",
    updated: "Last updated: July 2026",
    intro:
      'These Terms of Service ("Terms") govern your access to and use of RIVANT ("RIVANT", "we", "us", "our"), a business analytics dashboard available at rivant-os.vercel.app. By creating an account or using RIVANT, you agree to these Terms.',
    s1heading: "1. The Service",
    s1: "RIVANT provides business analytics, forecasting, and alerting tools based on data you connect (including but not limited to Stripe, Google Ads, Meta Ads, Shopify, QuickBooks, and CSV uploads). Features available depend on your subscription plan (Starter, Growth, Scale).",
    s2heading: "2. Accounts",
    s2: "You must provide accurate information when creating an account and are responsible for keeping your login credentials secure. You must be at least 18 years old to use RIVANT.",
    s3heading: "3. Subscriptions & Billing",
    s3: "Paid plans are billed monthly in advance. Payments are processed by Paddle.com Market Limited, our authorized reseller. By subscribing, you authorize recurring charges until you cancel. See our Refund Policy for details on refunds.",
    s4heading: "4. Free Trial",
    s4: "New accounts may receive a 14-day free trial with full feature access. No payment is required during the trial. At the end of the trial, continued access requires an active paid subscription.",
    s5heading: "5. Acceptable Use",
    s5: "You agree not to misuse RIVANT, attempt unauthorized access to our systems, upload unlawful content, or use the service to violate any applicable law.",
    s6heading: "6. Data & Third-Party Integrations",
    s6: "When you connect third-party services (e.g. Stripe, Google Ads, Meta Ads, Shopify, QuickBooks) or upload CSV files, you confirm you have the right to share this data with us. We process this data solely to provide analytics to you. See our Privacy Policy for details.",
    s7heading: "7. Termination",
    s7: "You may cancel your subscription at any time from your account settings. We may suspend or terminate accounts that violate these Terms.",
    s8heading: "8. Disclaimer & Limitation of Liability",
    s8: 'RIVANT is provided "as is". Forecasts and AI-generated insights are estimates based on available data and are not guaranteed to be accurate. RIVANT is not liable for business decisions made based on this data.',
    s9heading: "9. Changes to These Terms",
    s9: "We may update these Terms from time to time. Continued use of RIVANT after changes constitutes acceptance of the updated Terms.",
    s10heading: "10. Contact",
    s10: "Questions about these Terms can be sent through our contact form on the website.",
  },
  UA: {
    title: "Умови надання послуг",
    updated: "Востаннє оновлено: липень 2026",
    intro:
      'Ці Умови надання послуг ("Умови") регулюють ваш доступ до RIVANT ("RIVANT", "ми", "нас", "наш") — дашборду бізнес-аналітики, доступного за адресою rivant-os.vercel.app, та користування ним. Створюючи обліковий запис або користуючись RIVANT, ви погоджуєтеся з цими Умовами.',
    s1heading: "1. Сервіс",
    s1: "RIVANT надає інструменти бізнес-аналітики, прогнозування та сповіщень на основі даних, які ви підключаєте (зокрема, але не виключно, Stripe, Google Ads, Meta Ads, Shopify, QuickBooks та завантаження CSV). Доступні функції залежать від вашого тарифного плану (Starter, Growth, Scale).",
    s2heading: "2. Облікові записи",
    s2: "Ви зобов'язані вказувати точну інформацію при створенні облікового запису та несете відповідальність за збереження в таємниці своїх облікових даних для входу. Вам має бути не менше 18 років, щоб користуватися RIVANT.",
    s3heading: "3. Підписки та оплата",
    s3: "Платні тарифи оплачуються щомісяця авансом. Платежі обробляє Paddle.com Market Limited, наш авторизований реселер. Оформлюючи підписку, ви надаєте дозвіл на регулярні списання до моменту скасування. Деталі щодо повернення коштів — у нашій Політиці повернень.",
    s4heading: "4. Безкоштовний пробний період",
    s4: "Нові облікові записи можуть отримати 14-денний безкоштовний пробний період з повним доступом до функцій. Оплата протягом пробного періоду не потрібна. Після його завершення для подальшого доступу потрібна активна платна підписка.",
    s5heading: "5. Прийнятне використання",
    s5: "Ви погоджуєтеся не зловживати RIVANT, не намагатися отримати несанкціонований доступ до наших систем, не завантажувати протиправний контент і не використовувати сервіс для порушення чинного законодавства.",
    s6heading: "6. Дані та інтеграції з третіми сторонами",
    s6: "Підключаючи сторонні сервіси (наприклад, Stripe, Google Ads, Meta Ads, Shopify, QuickBooks) або завантажуючи CSV-файли, ви підтверджуєте, що маєте право передавати ці дані нам. Ми обробляємо ці дані виключно для надання вам аналітики. Деталі — у нашій Політиці конфіденційності.",
    s7heading: "7. Припинення дії",
    s7: "Ви можете скасувати підписку в будь-який момент у налаштуваннях облікового запису. Ми можемо призупинити або закрити облікові записи, що порушують ці Умови.",
    s8heading: "8. Відмова від відповідальності та обмеження відповідальності",
    s8: 'RIVANT надається "як є". Прогнози та інсайти, згенеровані ШІ, є оцінками на основі доступних даних і не гарантують точності. RIVANT не несе відповідальності за бізнес-рішення, прийняті на основі цих даних.',
    s9heading: "9. Зміни до цих Умов",
    s9: "Ми можемо періодично оновлювати ці Умови. Подальше користування RIVANT після внесення змін означає прийняття оновлених Умов.",
    s10heading: "10. Контакти",
    s10: "Запитання щодо цих Умов можна надіслати через контактну форму на сайті.",
  },
  DE: {
    title: "Allgemeine Geschäftsbedingungen",
    updated: "Zuletzt aktualisiert: Juli 2026",
    intro:
      'Diese Allgemeinen Geschäftsbedingungen ("Bedingungen") regeln Ihren Zugang zu und die Nutzung von RIVANT ("RIVANT", "wir", "uns", "unser"), einem unter rivant-os.vercel.app verfügbaren Business-Analytics-Dashboard. Durch die Erstellung eines Kontos oder die Nutzung von RIVANT stimmen Sie diesen Bedingungen zu.',
    s1heading: "1. Der Dienst",
    s1: "RIVANT bietet Werkzeuge für Geschäftsanalysen, Prognosen und Benachrichtigungen auf Basis der von Ihnen verbundenen Daten (u. a. Stripe, Google Ads, Meta Ads, Shopify, QuickBooks und CSV-Uploads). Der Funktionsumfang hängt von Ihrem Abonnement ab (Starter, Growth, Scale).",
    s2heading: "2. Konten",
    s2: "Sie müssen bei der Kontoerstellung korrekte Angaben machen und sind für die Sicherheit Ihrer Anmeldedaten verantwortlich. Sie müssen mindestens 18 Jahre alt sein, um RIVANT zu nutzen.",
    s3heading: "3. Abonnements und Abrechnung",
    s3: "Kostenpflichtige Pläne werden monatlich im Voraus abgerechnet. Zahlungen werden von Paddle.com Market Limited, unserem autorisierten Reseller, verarbeitet. Mit dem Abschluss eines Abonnements autorisieren Sie wiederkehrende Abbuchungen bis zur Kündigung. Details zu Rückerstattungen finden Sie in unserer Rückerstattungsrichtlinie.",
    s4heading: "4. Kostenlose Testphase",
    s4: "Neue Konten können eine 14-tägige kostenlose Testphase mit vollem Funktionsumfang erhalten. Während der Testphase ist keine Zahlung erforderlich. Nach Ablauf der Testphase ist für den weiteren Zugang ein aktives kostenpflichtiges Abonnement erforderlich.",
    s5heading: "5. Zulässige Nutzung",
    s5: "Sie verpflichten sich, RIVANT nicht zu missbrauchen, keinen unbefugten Zugriff auf unsere Systeme zu versuchen, keine rechtswidrigen Inhalte hochzuladen und den Dienst nicht zur Verletzung geltenden Rechts zu nutzen.",
    s6heading: "6. Daten und Integrationen von Drittanbietern",
    s6: "Wenn Sie Drittanbieterdienste verbinden (z. B. Stripe, Google Ads, Meta Ads, Shopify, QuickBooks) oder CSV-Dateien hochladen, bestätigen Sie, dass Sie berechtigt sind, diese Daten mit uns zu teilen. Wir verarbeiten diese Daten ausschließlich, um Ihnen Analysen bereitzustellen. Details finden Sie in unserer Datenschutzerklärung.",
    s7heading: "7. Kündigung",
    s7: "Sie können Ihr Abonnement jederzeit in Ihren Kontoeinstellungen kündigen. Wir können Konten, die gegen diese Bedingungen verstoßen, sperren oder kündigen.",
    s8heading: "8. Haftungsausschluss und Haftungsbeschränkung",
    s8: 'RIVANT wird "wie besehen" bereitgestellt. Prognosen und KI-generierte Erkenntnisse sind Schätzungen auf Basis verfügbarer Daten und keine Genauigkeitsgarantie. RIVANT haftet nicht für Geschäftsentscheidungen, die auf diesen Daten basieren.',
    s9heading: "9. Änderungen dieser Bedingungen",
    s9: "Wir können diese Bedingungen von Zeit zu Zeit aktualisieren. Die fortgesetzte Nutzung von RIVANT nach Änderungen gilt als Zustimmung zu den aktualisierten Bedingungen.",
    s10heading: "10. Kontakt",
    s10: "Fragen zu diesen Bedingungen können Sie über unser Kontaktformular auf der Website senden.",
  },
};

export default function TermsOfServicePage() {
  const { language } = useLanguage();
  const c = content[language];

  return (
    <div className="max-w-3xl mx-auto px-6 py-16 text-gray-300">
      <h1 className="text-3xl font-bold text-white mb-6">{c.title}</h1>
      <p className="text-sm text-gray-500 mb-8">{c.updated}</p>

      <div className="space-y-6 text-sm leading-relaxed">
        <p>{c.intro}</p>

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

        <h2 className="text-lg font-semibold text-white">{c.s7heading}</h2>
        <p>{c.s7}</p>

        <h2 className="text-lg font-semibold text-white">{c.s8heading}</h2>
        <p>{c.s8}</p>

        <h2 className="text-lg font-semibold text-white">{c.s9heading}</h2>
        <p>{c.s9}</p>

        <h2 className="text-lg font-semibold text-white">{c.s10heading}</h2>
        <p>{c.s10}</p>
      </div>
    </div>
  );
}