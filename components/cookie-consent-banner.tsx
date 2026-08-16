"use client";

// FIX (аудит п.8): раньше @vercel/analytics подключался в проде без какого-либо
// запроса согласия, при этом на сайте есть отдельная страница /cookies, которая
// по смыслу подразумевает наличие механизма согласия/отказа. Теперь баннер
// показывается один раз (до выбора пользователя) и Analytics не рендерится,
// пока пользователь явно не нажмёт "Accept".
import { useEffect, useState } from "react";
import { Analytics } from "@vercel/analytics/next";
import { useLanguage } from "@/lib/translations";

const STORAGE_KEY = "cookieConsent";

const text = {
  EN: {
    message:
      "We use essential cookies to keep you logged in and remember your language preference. See our",
    link: "Cookie Policy",
    accept: "Accept",
    decline: "Decline",
  },
  UA: {
    message:
      "Ми використовуємо необхідні файли cookie, щоб зберігати ваш вхід у систему та запам'ятовувати вибрану мову. Детальніше — у нашій",
    link: "Політиці щодо файлів cookie",
    accept: "Прийняти",
    decline: "Відхилити",
  },
  DE: {
    message:
      "Wir verwenden essenzielle Cookies, um Sie angemeldet zu halten und Ihre Sprachpräferenz zu speichern. Details finden Sie in unserer",
    link: "Cookie-Richtlinie",
    accept: "Akzeptieren",
    decline: "Ablehnen",
  },
};

export function CookieConsentBanner() {
  const { language } = useLanguage();
  const [consent, setConsent] = useState<"accepted" | "declined" | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "accepted" || stored === "declined") {
      setConsent(stored);
    }
    setHydrated(true);
  }, []);

  const choose = (value: "accepted" | "declined") => {
    window.localStorage.setItem(STORAGE_KEY, value);
    setConsent(value);
  };

  const t = text[language];

  return (
    <>
      {/* Analytics не грузится, пока пользователь явно не согласился. */}
      {consent === "accepted" && <Analytics />}

      {hydrated && consent === null && (
        <div className="fixed bottom-0 left-0 right-0 z-[9998] p-4 sm:p-6">
          <div className="max-w-3xl mx-auto bg-card border border-border rounded-xl shadow-lg p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <p className="text-sm text-muted-foreground flex-1">
              {t.message}{" "}
              <a href="/cookies" className="underline text-foreground">
                {t.link}
              </a>
              .
            </p>
            <div className="flex gap-2 shrink-0 w-full sm:w-auto">
              <button
                onClick={() => choose("declined")}
                className="flex-1 sm:flex-none px-4 py-2 text-sm font-medium rounded-lg bg-secondary text-foreground hover:bg-secondary/80"
              >
                {t.decline}
              </button>
              <button
                onClick={() => choose("accepted")}
                className="flex-1 sm:flex-none px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:opacity-90"
              >
                {t.accept}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}