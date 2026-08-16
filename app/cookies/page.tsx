"use client";

import { useLanguage } from "@/lib/translations";

// FIX (аудит п.7): страница раньше вообще не использовала useLanguage.
const content = {
  EN: {
    title: "Cookie Policy",
    updated: "Last updated: July 2026",
    intro: "RIVANT uses a small number of essential cookies necessary for the service to function:",
    auth: "Authentication cookies",
    authDesc: "keep you logged in securely between visits.",
    pref: "Preference cookies",
    prefDesc: "remember your language choice (EN/UA/DE).",
    outro:
      "We do not use advertising or tracking cookies. These essential cookies cannot be disabled, as they are required for RIVANT to work correctly.",
  },
  UA: {
    title: "Політика щодо файлів cookie",
    updated: "Востаннє оновлено: липень 2026",
    intro: "RIVANT використовує невелику кількість необхідних файлів cookie, потрібних для роботи сервісу:",
    auth: "Файли cookie автентифікації",
    authDesc: "безпечно зберігають ваш вхід у систему між відвідуваннями.",
    pref: "Файли cookie налаштувань",
    prefDesc: "запам'ятовують вибрану вами мову (EN/UA/DE).",
    outro:
      "Ми не використовуємо рекламні чи трекінгові файли cookie. Ці необхідні файли cookie неможливо вимкнути, оскільки вони потрібні для коректної роботи RIVANT.",
  },
  DE: {
    title: "Cookie-Richtlinie",
    updated: "Zuletzt aktualisiert: Juli 2026",
    intro: "RIVANT verwendet eine kleine Anzahl essenzieller Cookies, die für den Betrieb des Dienstes erforderlich sind:",
    auth: "Authentifizierungs-Cookies",
    authDesc: "halten Sie zwischen Besuchen sicher angemeldet.",
    pref: "Präferenz-Cookies",
    prefDesc: "speichern Ihre Sprachauswahl (EN/UA/DE).",
    outro:
      "Wir verwenden keine Werbe- oder Tracking-Cookies. Diese essenziellen Cookies können nicht deaktiviert werden, da sie für die korrekte Funktion von RIVANT erforderlich sind.",
  },
};

export default function CookiePolicyPage() {
  const { language } = useLanguage();
  const c = content[language];

  return (
    <div className="max-w-3xl mx-auto px-6 py-16 text-gray-300">
      <h1 className="text-3xl font-bold text-white mb-6">{c.title}</h1>
      <p className="text-sm text-gray-500 mb-8">{c.updated}</p>

      <div className="space-y-6 text-sm leading-relaxed">
        <p>{c.intro}</p>
        <p>
          - <strong>{c.auth}</strong> — {c.authDesc}
          <br />- <strong>{c.pref}</strong> — {c.prefDesc}
        </p>
        <p>{c.outro}</p>
      </div>
    </div>
  );
}