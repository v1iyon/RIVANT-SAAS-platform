"use client";

import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { DollarSign, Users, Cpu, Megaphone, TrendingDown } from "lucide-react";
import { useLanguage } from "@/lib/translations";
import { useCurrency } from "@/lib/currency";

export function LossCalculator() {
  const { t, language } = useLanguage();
  const { currency, convert } = useCurrency();
  const T = t as any;

  const [revenue, setRevenue] = useState([100000]);
  const [teamSize, setTeamSize] = useState([25]);
  const [techEfficiency, setTechEfficiency] = useState([60]);
  const [marketingChannels, setMarketingChannels] = useState([4]);
  const [email, setEmail] = useState("");
  // Honeypot: реальні люди це поле ніколи не бачать і не заповнюють (сховане
  // стилями нижче) — той самий патерн, що вже є в components/contact-form.tsx.
  // Раніше в цьому компоненті такого поля не було взагалі, хоча запит іде в
  // той самий /api/contact, який honeypot перевіряє (lib/rate-limit.js::
  // isHoneypotTripped) — саме калькулятор, найпомітніший інтерактивний CTA
  // лендінгу, лишався незахищеним від скрипт-ботів.
  const [websiteUrl, setWebsiteUrl] = useState("");

  const calculateLoss = () => {
    const r = revenue[0];
    const tSize = teamSize[0];
    const tEff = techEfficiency[0];
    const mChan = marketingChannels[0];

    const revenueFactor = r * 0.08;
    const teamFactor = tSize * 200;
    const techFactor = ((100 - tEff) / 100) * r * 0.05;
    const marketingFactor = mChan * 1500;

    return Math.round(revenueFactor + teamFactor + techFactor + marketingFactor);
  };

  const estimatedLoss = calculateLoss();

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(convert(value));
  };

  // ФІКС (маркетинговий розворот, 2026-09-10): раніше кнопка вела в
  // /api/contact і закінчувалась тупиковим "Дякуємо, зв'яжемось протягом
  // 24 годин" — людина щойно побачила конкретну суму втрат і одразу
  // впиралась у стіну очікування замість можливості одразу щось з цим
  // зробити. Тепер: лід у /api/contact все одно летить (маркетологу
  // потрібні ці дані навіть від тих, хто не дорегеструється — джерело
  // "loss_calculator" видно в /admin/leads), але це fire-and-forget —
  // ми НЕ чекаємо відповіді і НЕ показуємо "успішно надіслано". Замість
  // цього одразу відкриваємо модалку реєстрації (той самий механізм, що
  // й у кнопок тарифів — rivant:open-signup) з уже підставленим email,
  // щоб не змушувати вводити його вдруге. Помилка запису ліда — не привід
  // блокувати людину, що йде реєструватись, тому тут немає catch->error UI.
  const handleGetStarted = () => {
    const trimmedEmail = email.trim();

    if (trimmedEmail) {
      fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Loss Calculator Lead",
          company: "—",
          email: trimmedEmail,
          source: "loss_calculator",
          website_url: websiteUrl,
          message: `Estimated monthly loss: ${formatCurrency(estimatedLoss)}\n\nInputs:\n- Monthly Revenue: ${formatCurrency(revenue[0])}\n- Team Size: ${teamSize[0]}\n- Tech Stack Efficiency: ${techEfficiency[0]}%\n- Marketing Channels: ${marketingChannels[0]}`,
        }),
      }).catch((e) => console.error("loss-calculator lead capture failed:", e));
    }

    window.dispatchEvent(
      new CustomEvent("rivant:open-signup", { detail: trimmedEmail ? { email: trimmedEmail } : undefined })
    );
  };

  return (
    <section id="calculator" className="py-6 relative px-4">
      <div className="max-w-4xl mx-auto bg-card rounded-2xl p-5 sm:p-7 mb-6 border border-border shadow-sm">
        <div className="text-center mb-5 p-4 bg-secondary/50 rounded-xl select-none">
          <p className="text-sm text-muted-foreground uppercase tracking-wider mb-2">{t.estimatedLoss || "Estimated Monthly Loss"}</p>
          <div className="flex items-center justify-center gap-2">
            <TrendingDown className="w-6 h-6 sm:w-7 sm:h-7 text-destructive" />
            <span className="text-3xl sm:text-5xl font-bold text-destructive tabular-nums">
              {formatCurrency(estimatedLoss)}
            </span>
          </div>
        </div>

        <div className="space-y-5">
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="font-medium flex items-center gap-2 select-none">
                <DollarSign className="w-4 h-4 text-primary" />{t.monthlyRevenue || "Monthly Revenue"}
              </label>
              <span className="font-bold tabular-nums">{formatCurrency(revenue[0])}</span>
            </div>
            <Slider value={revenue} onValueChange={setRevenue} min={10000} max={1000000} step={10000} />
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="font-medium flex items-center gap-2 select-none">
                <Users className="w-4 h-4 text-primary" />{t.teamSize || "Team Size"}
              </label>
              <span className="font-bold tabular-nums">{teamSize[0]}</span>
            </div>
            <Slider value={teamSize} onValueChange={setTeamSize} min={1} max={200} step={1} />
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="font-medium flex items-center gap-2 select-none">
                <Cpu className="w-4 h-4 text-primary" />{t.techEfficiency || "Tech Stack Efficiency"}
              </label>
              <span className="font-bold tabular-nums">{techEfficiency[0]}%</span>
            </div>
            <Slider value={techEfficiency} onValueChange={setTechEfficiency} min={10} max={100} step={5} />
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="font-medium flex items-center gap-2 select-none">
                <Megaphone className="w-4 h-4 text-primary" />{t.marketingChannels || "Marketing Channels"}
              </label>
              <span className="font-bold tabular-nums">{marketingChannels[0]}</span>
            </div>
            <Slider value={marketingChannels} onValueChange={setMarketingChannels} min={1} max={10} step={1} />
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <p className="text-center text-sm text-muted-foreground">
            {language === "UA"
              ? "RIVANT допоможе зупинити ці втрати. Зареєструйтесь і отримайте 14 днів безкоштовно."
              : language === "DE"
              ? "RIVANT hilft, diese Verluste zu stoppen. Registrieren Sie sich und erhalten Sie 14 Tage kostenlos."
              : "RIVANT can help you stop losing this money. Sign up and get 14 days free."}
          </p>

          {/* Honeypot: видиме ботам, невидиме людям. Не чіпати tabIndex/
              autoComplete/position — саме так поле лишається невидимим
              і недосяжним для реальної клавіатурної навігації. */}
          <input
            type="text"
            name="website_url"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px", opacity: 0 }}
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={language === "UA" ? "Ваша робоча пошта" : language === "DE" ? "Ihre geschäftliche E-Mail" : "Your work email"}
            className="w-full px-4 py-3 bg-input border border-border rounded-lg text-foreground"
          />
          <Button
            className="w-full py-6 text-lg font-bold shadow-lg hover:shadow-primary/20"
            onClick={handleGetStarted}
          >
            {language === "UA"
              ? "Спробувати безкоштовно 14 днів"
              : language === "DE"
              ? "14 Tage kostenlos testen"
              : "Start your 14-day free trial"}
          </Button>
        </div>
      </div>
    </section>
  );
}