"use client";

import { useState, useEffect } from "react";
import { Slider } from "@/components/ui/slider";
import { DollarSign, Users, Cpu, Megaphone, TrendingDown } from "lucide-react";
import { useLanguage } from "@/lib/translations";

function useCountUp(target: number, duration: number = 1000) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let startTime: number;
    let animationFrame: number;
    const startValue = count;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      
      // Easing function for smooth animation
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      const currentValue = Math.floor(startValue + (target - startValue) * easeOutQuart);
      
      setCount(currentValue);
      
      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [target, duration]);

  return count;
}

export function LossCalculator() {
  const { t } = useLanguage();
  const [revenue, setRevenue] = useState([100000]);
  const [teamSize, setTeamSize] = useState([25]);
  const [techEfficiency, setTechEfficiency] = useState([60]);
  const [marketingChannels, setMarketingChannels] = useState([4]);

  // Calculate estimated monthly loss
  const calculateLoss = () => {
    const revenueFactor = revenue[0] * 0.08; // 8% baseline loss on revenue
    const teamFactor = teamSize[0] * 200; // $200 per team member in inefficiency
    const techFactor = ((100 - techEfficiency[0]) / 100) * revenue[0] * 0.05; // Tech inefficiency costs
    const marketingFactor = marketingChannels[0] * 1500; // Fragmented marketing cost

    return Math.round(revenueFactor + teamFactor + techFactor + marketingFactor);
  };

  const estimatedLoss = calculateLoss();
  const animatedLoss = useCountUp(estimatedLoss, 500);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <section id="calculator" className="py-16 sm:py-24 relative px-4">
      <div className="max-w-7xl mx-auto">
        {/* Section Header */}
        <div className="text-center mb-10 sm:mb-16">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-foreground mb-3 sm:mb-4 text-balance">
            {t.calcTitle} <span className="text-primary">{t.calcTitleHighlight}</span>
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto text-pretty">
            {t.calcSubtitle}
          </p>
        </div>

        <div className="max-w-4xl mx-auto">
          <div className="bg-card rounded-2xl p-5 sm:p-8 md:p-10 border border-border">
            {/* Loss Display */}
            <div className="text-center mb-8 sm:mb-12 p-5 sm:p-8 bg-secondary rounded-xl">
              <p className="text-xs sm:text-sm text-muted-foreground mb-2 uppercase tracking-wider">
                {t.estimatedLoss}
              </p>
              <div className="flex items-center justify-center gap-2 sm:gap-3">
                <TrendingDown className="w-8 h-8 sm:w-10 sm:h-10 text-destructive animate-pulse" />
                <span className="text-3xl sm:text-5xl md:text-6xl font-bold text-destructive tabular-nums">
                  {formatCurrency(animatedLoss)}
                </span>
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground mt-3 sm:mt-4">
                {"That's"}{" "}
                <span className="text-foreground font-semibold">
                  {formatCurrency(animatedLoss * 12)}
                </span>{" "}
                {t.perYear}
              </p>
            </div>

            {/* Sliders */}
            <div className="space-y-8 sm:space-y-10">
              {/* Monthly Revenue */}
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 sm:w-10 sm:h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <DollarSign className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground text-sm sm:text-base">{t.monthlyRevenue}</p>
                      <p className="text-xs sm:text-sm text-muted-foreground">{t.revenueDesc}</p>
                    </div>
                  </div>
                  <span className="text-base sm:text-lg font-semibold text-foreground tabular-nums ml-13 sm:ml-0">
                    {formatCurrency(revenue[0])}
                  </span>
                </div>
                <Slider
                  value={revenue}
                  onValueChange={setRevenue}
                  min={10000}
                  max={1000000}
                  step={10000}
                  className="[&_[data-slot=slider-track]]:bg-border [&_[data-slot=slider-track]]:h-3 [&_[data-slot=slider-range]]:bg-primary [&_[data-slot=slider-thumb]]:border-primary [&_[data-slot=slider-thumb]]:w-6 [&_[data-slot=slider-thumb]]:h-6"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>$10K</span>
                  <span>$1M</span>
                </div>
              </div>

              {/* Team Size */}
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 sm:w-10 sm:h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Users className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground text-sm sm:text-base">{t.teamSize}</p>
                      <p className="text-xs sm:text-sm text-muted-foreground">{t.teamDesc}</p>
                    </div>
                  </div>
                  <span className="text-base sm:text-lg font-semibold text-foreground tabular-nums ml-13 sm:ml-0">
                    {teamSize[0]} {t.people}
                  </span>
                </div>
                <Slider
                  value={teamSize}
                  onValueChange={setTeamSize}
                  min={1}
                  max={200}
                  step={1}
                  className="[&_[data-slot=slider-track]]:bg-border [&_[data-slot=slider-track]]:h-3 [&_[data-slot=slider-range]]:bg-primary [&_[data-slot=slider-thumb]]:border-primary [&_[data-slot=slider-thumb]]:w-6 [&_[data-slot=slider-thumb]]:h-6"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1</span>
                  <span>200+</span>
                </div>
              </div>

              {/* Tech Stack Efficiency */}
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 sm:w-10 sm:h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Cpu className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground text-sm sm:text-base">{t.techEfficiency}</p>
                      <p className="text-xs sm:text-sm text-muted-foreground">{t.techDesc}</p>
                    </div>
                  </div>
                  <span className="text-base sm:text-lg font-semibold text-foreground tabular-nums ml-13 sm:ml-0">
                    {techEfficiency[0]}%
                  </span>
                </div>
                <Slider
                  value={techEfficiency}
                  onValueChange={setTechEfficiency}
                  min={10}
                  max={100}
                  step={5}
                  className="[&_[data-slot=slider-track]]:bg-border [&_[data-slot=slider-track]]:h-3 [&_[data-slot=slider-range]]:bg-primary [&_[data-slot=slider-thumb]]:border-primary [&_[data-slot=slider-thumb]]:w-6 [&_[data-slot=slider-thumb]]:h-6"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t.fragmented}</span>
                  <span>{t.fullyIntegrated}</span>
                </div>
              </div>

              {/* Marketing Channels */}
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 sm:w-10 sm:h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Megaphone className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground text-sm sm:text-base">{t.marketingChannels}</p>
                      <p className="text-xs sm:text-sm text-muted-foreground">{t.marketingDesc}</p>
                    </div>
                  </div>
                  <span className="text-base sm:text-lg font-semibold text-foreground tabular-nums ml-13 sm:ml-0">
                    {marketingChannels[0]} {marketingChannels[0] === 1 ? t.channel : t.channels}
                  </span>
                </div>
                <Slider
                  value={marketingChannels}
                  onValueChange={setMarketingChannels}
                  min={1}
                  max={10}
                  step={1}
                  className="[&_[data-slot=slider-track]]:bg-border [&_[data-slot=slider-track]]:h-3 [&_[data-slot=slider-range]]:bg-primary [&_[data-slot=slider-thumb]]:border-primary [&_[data-slot=slider-thumb]]:w-6 [&_[data-slot=slider-thumb]]:h-6"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1 {t.channel}</span>
                  <span>10+ {t.channels}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
