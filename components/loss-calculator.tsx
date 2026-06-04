"use client";

import { useState, useEffect } from "react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { DollarSign, Users, Cpu, Megaphone, TrendingDown } from "lucide-react";
import { useLanguage } from "@/lib/translations";

export function LossCalculator() {
  const { t } = useLanguage();
  const [isMobile, setIsMobile] = useState(true); // По умолчанию скрыт

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const [revenue, setRevenue] = useState([100000]);
  const [teamSize, setTeamSize] = useState([25]);
  const [techEfficiency, setTechEfficiency] = useState([60]);
  const [marketingChannels, setMarketingChannels] = useState([4]);

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
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  };

  // НА ТЕЛЕФОНЕ НЕ ПОКАЗЫВАЕМ ВООБЩЕ НИЧЕГО
  if (isMobile) {
    return null;
  }

  return (
    <section id="calculator" className="py-12 relative px-4">
      <div className="max-w-4xl mx-auto bg-card rounded-2xl p-6 sm:p-10 mb-20 border border-border shadow-sm">
        <div className="text-center mb-8 p-6 bg-secondary/50 rounded-xl select-none">
          <p className="text-sm text-muted-foreground uppercase tracking-wider mb-2">{t.estimatedLoss || "Estimated Monthly Loss"}</p>
          <div className="flex items-center justify-center gap-2">
            <TrendingDown className="w-8 h-8 text-destructive" />
            <span className="text-4xl sm:text-6xl font-bold text-destructive tabular-nums">
              {formatCurrency(estimatedLoss)}
            </span>
          </div>
        </div>

        <div className="space-y-8">
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

        <div className="mt-10">
          <Button className="w-full py-6 text-lg font-bold shadow-lg hover:shadow-primary/20" onClick={() => alert("Request sent!")}>
            {t.requestDemoBtn || "Send Request"}
          </Button>
        </div>
      </div>
    </section>
  );
}