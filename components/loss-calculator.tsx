"use client";

import { useState, useEffect } from "react";
import { Slider } from "@/components/ui/slider";
import { DollarSign, Users, Cpu, Megaphone, TrendingDown } from "lucide-react";

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
    <section id="calculator" className="py-24 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            Calculate Your <span className="text-primary">Hidden Losses</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Adjust the sliders to see how much your business might be losing each month
            due to operational inefficiencies.
          </p>
        </div>

        <div className="max-w-4xl mx-auto">
          <div className="glass rounded-2xl p-8 sm:p-10">
            {/* Loss Display */}
            <div className="text-center mb-12 p-8 glass-strong rounded-xl">
              <p className="text-sm text-muted-foreground mb-2 uppercase tracking-wider">
                Estimated Monthly Loss
              </p>
              <div className="flex items-center justify-center gap-3">
                <TrendingDown className="w-10 h-10 text-destructive animate-pulse" />
                <span className="text-5xl sm:text-6xl font-bold text-destructive tabular-nums">
                  {formatCurrency(animatedLoss)}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-4">
                That&apos;s{" "}
                <span className="text-foreground font-semibold">
                  {formatCurrency(animatedLoss * 12)}
                </span>{" "}
                per year you could be saving.
              </p>
            </div>

            {/* Sliders */}
            <div className="space-y-10">
              {/* Monthly Revenue */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <DollarSign className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">Monthly Revenue</p>
                      <p className="text-sm text-muted-foreground">Your current monthly revenue</p>
                    </div>
                  </div>
                  <span className="text-lg font-semibold text-foreground tabular-nums">
                    {formatCurrency(revenue[0])}
                  </span>
                </div>
                <Slider
                  value={revenue}
                  onValueChange={setRevenue}
                  min={10000}
                  max={1000000}
                  step={10000}
                  className="[&_[data-slot=slider-track]]:bg-border [&_[data-slot=slider-range]]:bg-primary [&_[data-slot=slider-thumb]]:border-primary"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>$10K</span>
                  <span>$1M</span>
                </div>
              </div>

              {/* Team Size */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Users className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">Team Size</p>
                      <p className="text-sm text-muted-foreground">Number of employees</p>
                    </div>
                  </div>
                  <span className="text-lg font-semibold text-foreground tabular-nums">
                    {teamSize[0]} people
                  </span>
                </div>
                <Slider
                  value={teamSize}
                  onValueChange={setTeamSize}
                  min={1}
                  max={200}
                  step={1}
                  className="[&_[data-slot=slider-track]]:bg-border [&_[data-slot=slider-range]]:bg-primary [&_[data-slot=slider-thumb]]:border-primary"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1</span>
                  <span>200+</span>
                </div>
              </div>

              {/* Tech Stack Efficiency */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Cpu className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">Tech Stack Efficiency</p>
                      <p className="text-sm text-muted-foreground">How integrated are your tools?</p>
                    </div>
                  </div>
                  <span className="text-lg font-semibold text-foreground tabular-nums">
                    {techEfficiency[0]}%
                  </span>
                </div>
                <Slider
                  value={techEfficiency}
                  onValueChange={setTechEfficiency}
                  min={10}
                  max={100}
                  step={5}
                  className="[&_[data-slot=slider-track]]:bg-border [&_[data-slot=slider-range]]:bg-primary [&_[data-slot=slider-thumb]]:border-primary"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Fragmented</span>
                  <span>Fully Integrated</span>
                </div>
              </div>

              {/* Marketing Channels */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Megaphone className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">Marketing Channels</p>
                      <p className="text-sm text-muted-foreground">Active advertising platforms</p>
                    </div>
                  </div>
                  <span className="text-lg font-semibold text-foreground tabular-nums">
                    {marketingChannels[0]} channels
                  </span>
                </div>
                <Slider
                  value={marketingChannels}
                  onValueChange={setMarketingChannels}
                  min={1}
                  max={10}
                  step={1}
                  className="[&_[data-slot=slider-track]]:bg-border [&_[data-slot=slider-range]]:bg-primary [&_[data-slot=slider-thumb]]:border-primary"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1 channel</span>
                  <span>10+ channels</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
