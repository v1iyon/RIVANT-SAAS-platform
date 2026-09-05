"use client";

import { useLanguage } from "@/lib/translations";

// FIX (аудит п.7): страница раньше вообще не использовала useLanguage —
// весь текст был захардкожен на английском независимо от выбранного языка.
const content = {
  EN: {
    title: "Privacy Policy",
    updated: "Last updated: July 2026",
    intro:
      "This Privacy Policy explains how RIVANT collects, uses, and protects your information when you use our service.",
    s1heading: "1. Information We Collect",
    s1: [
      "Account information: email address, name, phone number (optional).",
      "Business data: revenue, expenses, and advertising performance metrics from third-party services you connect, including Stripe, Shopify, WooCommerce, PayPal, Mollie, QuickBooks, Google Ads, and Meta Ads, or upload via CSV.",
      "Usage data: how you interact with the dashboard, for the purpose of improving the product.",
    ],
    s2heading: "2. How We Use Your Data",
    s2: "We use your data to provide the analytics, forecasts, and alerts you see in your dashboard, to process payments (via Paddle), and to communicate with you about your account.",
    s3heading: "3. Data Sharing",
    s3a: "We do not sell your data. We share data only with service providers necessary to operate RIVANT, including Supabase (database hosting), Paddle (payment processing), and the advertising and business platforms you connect (Stripe, Shopify, WooCommerce, PayPal, Mollie, QuickBooks, Google Ads, Meta Ads) for read-only data access.",
    s3quickbooks: "QuickBooks is connected through Intuit's OAuth 2.0 authorization, not an API key you enter manually: you sign in and grant RIVANT read-only access to your accounting data directly on Intuit's own consent screen, and you can revoke this access at any time from your Intuit account or from RIVANT's Integrations settings.",
    s3bBefore:
      "Data obtained through the Google Ads API is used solely to display advertising spend and performance metrics on your own RIVANT dashboard. We do not share this data with any third party except the infrastructure providers listed above, necessary to store it securely, and we do not use it for advertising, profiling, or any purpose other than providing our service to you. Our use and transfer of information received from Google APIs complies with the",
    s3link: "Google API Services User Data Policy",
    s3bAfter: ", including the Limited Use requirements.",
    s4heading: "4. Data Storage & Security",
    s4: "Your data is stored securely using Supabase infrastructure. We take reasonable technical measures to protect your information from unauthorized access.",
    s5heading: "5. Data Retention",
    s5: "We retain your data for as long as your account is active. You can request deletion of your account and all associated data at any time from Settings → Danger Zone, or by contacting us.",
    s6heading: "6. Your Rights",
    s6: "You may access, correct, export, or delete your personal data at any time. Contact us if you need help exercising these rights.",
    s7heading: "7. Cookies",
    s7: "We use essential cookies to keep you logged in and remember your language preference. See our Cookie Policy for details.",
    s8heading: "8. Changes to This Policy",
    s8: "We may update this Privacy Policy from time to time. We will notify users of significant changes.",
    s9heading: "9. Contact",
    s9: "Questions about this policy can be sent through our contact form on the website.",
  },
  UA: {
    title: "Політика конфіденційності",
    updated: "Востаннє оновлено: липень 2026",
    intro:
      "Ця Політика конфіденційності пояснює, як RIVANT збирає, використовує та захищає вашу інформацію під час користування нашим сервісом.",
    s1heading: "1. Яку інформацію ми збираємо",
    s1: [
      "Дані облікового запису: адреса електронної пошти, ім'я, номер телефону (необов'язково).",
      "Бізнес-дані: виручка, витрати та показники ефективності реклами із сторонніх сервісів, які ви підключаєте, зокрема Stripe, Shopify, WooCommerce, PayPal, Mollie, QuickBooks, Google Ads та Meta Ads, або завантажені через CSV.",
      "Дані про використання: як ви взаємодієте з дашбордом — з метою покращення продукту.",
    ],
    s2heading: "2. Як ми використовуємо ваші дані",
    s2: "Ми використовуємо ваші дані, щоб надавати аналітику, прогнози та сповіщення, які ви бачите в дашборді, обробляти платежі (через Paddle) та зв'язуватися з вами щодо вашого облікового запису.",
    s3heading: "3. Передача даних третім особам",
    s3a: "Ми не продаємо ваші дані. Ми передаємо дані лише постачальникам послуг, необхідним для роботи RIVANT, зокрема Supabase (хостинг бази даних), Paddle (обробка платежів), а також рекламним і бізнес-платформам, які ви підключаєте (Stripe, Shopify, WooCommerce, PayPal, Mollie, QuickBooks, Google Ads, Meta Ads), для доступу до даних лише для читання.",
    s3quickbooks: "QuickBooks підключається через авторизацію OAuth 2.0 від Intuit, а не через API-ключ, який ви вводите вручну: ви входите у свій обліковий запис Intuit і надаєте RIVANT доступ лише для читання бухгалтерських даних безпосередньо на екрані згоди Intuit, і можете відкликати цей доступ у будь-який момент — зі свого облікового запису Intuit або з розділу «Інтеграції» в RIVANT.",
    s3bBefore:
      "Дані, отримані через Google Ads API, використовуються виключно для відображення рекламних витрат і показників ефективності у вашому власному дашборді RIVANT. Ми не передаємо ці дані жодній третій стороні, окрім перелічених вище інфраструктурних постачальників, необхідних для їх безпечного зберігання, і не використовуємо їх для реклами, профілювання чи будь-якої іншої мети, окрім надання вам нашого сервісу. Наше використання й передача інформації, отриманої через API Google, відповідає",
    s3link: "Політиці використання даних користувачів API-сервісів Google",
    s3bAfter: ", включно з вимогами Limited Use.",
    s4heading: "4. Зберігання та захист даних",
    s4: "Ваші дані надійно зберігаються на інфраструктурі Supabase. Ми вживаємо розумних технічних заходів для захисту вашої інформації від несанкціонованого доступу.",
    s5heading: "5. Термін зберігання даних",
    s5: "Ми зберігаємо ваші дані, доки ваш обліковий запис активний. Ви можете в будь-який момент запросити видалення облікового запису та всіх пов'язаних даних у розділі Settings → Danger Zone або звернувшись до нас.",
    s6heading: "6. Ваші права",
    s6: "Ви можете в будь-який час отримати доступ до своїх персональних даних, виправити, експортувати або видалити їх. Зверніться до нас, якщо потрібна допомога у реалізації цих прав.",
    s7heading: "7. Файли cookie",
    s7: "Ми використовуємо необхідні файли cookie, щоб зберігати ваш вхід у систему та запам'ятовувати вибрану мову. Детальніше — у нашій Політиці щодо файлів cookie.",
    s8heading: "8. Зміни до цієї Політики",
    s8: "Ми можемо періодично оновлювати цю Політику конфіденційності. Про суттєві зміни ми повідомлятимемо користувачів.",
    s9heading: "9. Контакти",
    s9: "Запитання щодо цієї політики можна надіслати через контактну форму на сайті.",
  },
  DE: {
    title: "Datenschutzerklärung",
    updated: "Zuletzt aktualisiert: Juli 2026",
    intro:
      "Diese Datenschutzerklärung erläutert, wie RIVANT Ihre Informationen bei der Nutzung unseres Dienstes erhebt, verwendet und schützt.",
    s1heading: "1. Welche Informationen wir erheben",
    s1: [
      "Kontoinformationen: E-Mail-Adresse, Name, Telefonnummer (optional).",
      "Geschäftsdaten: Umsatz, Ausgaben und Werbeleistungskennzahlen aus Drittanbieterdiensten, die Sie verbinden, darunter Stripe, Shopify, WooCommerce, PayPal, Mollie, QuickBooks, Google Ads und Meta Ads, oder per CSV hochgeladen.",
      "Nutzungsdaten: wie Sie mit dem Dashboard interagieren, um das Produkt zu verbessern.",
    ],
    s2heading: "2. Wie wir Ihre Daten verwenden",
    s2: "Wir verwenden Ihre Daten, um die Analysen, Prognosen und Benachrichtigungen bereitzustellen, die Sie in Ihrem Dashboard sehen, um Zahlungen zu verarbeiten (über Paddle) und um mit Ihnen bezüglich Ihres Kontos zu kommunizieren.",
    s3heading: "3. Weitergabe von Daten",
    s3a: "Wir verkaufen Ihre Daten nicht. Wir geben Daten nur an Dienstleister weiter, die für den Betrieb von RIVANT erforderlich sind, darunter Supabase (Datenbank-Hosting), Paddle (Zahlungsabwicklung) sowie die von Ihnen verbundenen Werbe- und Geschäftsplattformen (Stripe, Shopify, WooCommerce, PayPal, Mollie, QuickBooks, Google Ads, Meta Ads) für einen reinen Lesezugriff auf die Daten.",
    s3quickbooks: "QuickBooks wird über die OAuth-2.0-Autorisierung von Intuit verbunden, nicht über einen manuell eingegebenen API-Schlüssel: Sie melden sich bei Intuit an und gewähren RIVANT direkt auf dem Zustimmungsbildschirm von Intuit einen reinen Lesezugriff auf Ihre Buchhaltungsdaten. Sie können diesen Zugriff jederzeit über Ihr Intuit-Konto oder über die Integrationseinstellungen von RIVANT widerrufen.",
    s3bBefore:
      "Über die Google-Ads-API erhaltene Daten werden ausschließlich verwendet, um Werbeausgaben und Leistungskennzahlen in Ihrem eigenen RIVANT-Dashboard anzuzeigen. Wir geben diese Daten an keine Dritten weiter, außer an die oben genannten Infrastrukturanbieter, die für eine sichere Speicherung erforderlich sind, und wir verwenden sie nicht für Werbung, Profiling oder andere Zwecke als die Bereitstellung unseres Dienstes für Sie. Unsere Nutzung und Weitergabe von Informationen aus Google-APIs entspricht der",
    s3link: "Google API Services User Data Policy",
    s3bAfter: ", einschließlich der Limited-Use-Anforderungen.",
    s4heading: "4. Datenspeicherung und Sicherheit",
    s4: "Ihre Daten werden sicher über die Supabase-Infrastruktur gespeichert. Wir treffen angemessene technische Maßnahmen, um Ihre Informationen vor unbefugtem Zugriff zu schützen.",
    s5heading: "5. Datenspeicherdauer",
    s5: "Wir bewahren Ihre Daten so lange auf, wie Ihr Konto aktiv ist. Sie können jederzeit die Löschung Ihres Kontos und aller zugehörigen Daten über Settings → Danger Zone beantragen oder sich an uns wenden.",
    s6heading: "6. Ihre Rechte",
    s6: "Sie können jederzeit auf Ihre personenbezogenen Daten zugreifen, sie korrigieren, exportieren oder löschen. Kontaktieren Sie uns, wenn Sie Hilfe bei der Ausübung dieser Rechte benötigen.",
    s7heading: "7. Cookies",
    s7: "Wir verwenden essenzielle Cookies, um Sie angemeldet zu halten und Ihre Sprachpräferenz zu speichern. Details finden Sie in unserer Cookie-Richtlinie.",
    s8heading: "8. Änderungen dieser Richtlinie",
    s8: "Wir können diese Datenschutzerklärung von Zeit zu Zeit aktualisieren. Über wesentliche Änderungen werden wir die Nutzer informieren.",
    s9heading: "9. Kontakt",
    s9: "Fragen zu dieser Richtlinie können Sie über unser Kontaktformular auf der Website senden.",
  },
};

export default function PrivacyPolicyPage() {
  const { language } = useLanguage();
  const c = content[language];

  return (
    <div className="max-w-3xl mx-auto px-6 py-16 text-gray-300">
      <h1 className="text-3xl font-bold text-white mb-6">{c.title}</h1>
      <p className="text-sm text-gray-500 mb-8">{c.updated}</p>

      <div className="space-y-6 text-sm leading-relaxed">
        <p>{c.intro}</p>

        <h2 className="text-lg font-semibold text-white">{c.s1heading}</h2>
        <p>
          - {c.s1[0]}
          <br />- {c.s1[1]}
          <br />- {c.s1[2]}
        </p>

        <h2 className="text-lg font-semibold text-white">{c.s2heading}</h2>
        <p>{c.s2}</p>

        <h2 className="text-lg font-semibold text-white">{c.s3heading}</h2>
        <p>{c.s3a}</p>
        <p>{c.s3quickbooks}</p>
        <p>
          {c.s3bBefore}{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className="underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {c.s3link}
          </a>
          {c.s3bAfter}
        </p>

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
      </div>
    </div>
  );
}