"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { loadPaddle, openPaddleCheckout } from "@/lib/paddle-client";
import { Button } from "@/components/ui/button";
import { Check, Zap, Settings, FileText, Users, ArrowRight } from "lucide-react";
import { useLanguage } from "@/lib/translations";

type Plan = {
  name: string;
  price: number;
  description: string;
  features: string[];
  popular: boolean;
};

const PRICE_IDS: Record<string, string> = {
  starter: process.env.NEXT_PUBLIC_PADDLE_PRICE_STARTER!,
  growth: process.env.NEXT_PUBLIC_PADDLE_PRICE_GROWTH!,
  scale: process.env.NEXT_PUBLIC_PADDLE_PRICE_SCALE!,
};

export function PricingSection() {
  const { t } = useLanguage();
  const T = t as any;
  const supabase = createClient();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  const planKeyMap: Record<string, string> = {
    [T.starter ?? "Starter"]: "starter",
    [T.growth ?? "Growth"]: "growth",
    [T.scale ?? "Scale"]: "scale",
  };

  const handleGetStarted = async (planName: string) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      alert(T.pleaseSignInFirst ?? "Please sign in first");
      return;
    }
    const planKey = planKeyMap[planName];
    const priceId = PRICE_IDS[planKey];

    setLoadingPlan(planKey);
    try {
      await loadPaddle();
      openPaddleCheckout({
        priceId,
        email: data.session.user.email!,
        plan: planKey,
      });
    } catch (e) {
      console.error("paddle checkout error:", e);
      alert("Не удалось открыть окно оплаты");
    } finally {
      setLoadingPlan(null);
    }
  };

  const plans: Plan[] = [
    {
      name: T.starter ?? "Starter",
      price: 99,
      description: T.pricingSubtitle ?? "Best for individuals starting out",
      features: T.starterFeatures ?? [],
      popular: false,
    },
    {
      name: T.growth ?? "Growth",
      price: 299,
      description: T.pricingSubtitle ?? "Best for growing teams",
      features: T.growthFeatures ?? [],
      popular: true,
    },
    {
      name: T.scale ?? "Scale",
      price: 499,
      description: T.pricingSubtitle ?? "Best for scaling businesses",
      features: T.scaleFeatures ?? [],
      popular: false,
    },
  ];

  const addons = [
    { icon: Settings, name: T.businessSetup ?? "Business Setup", price: 199, priceType: T.oneTime ?? "One-time", description: T.businessSetupDesc ?? "Professional setup service" },
    { icon: FileText, name: T.quarterlyAudit ?? "Quarterly Audit", price: 299, priceType: T.perQuarter ?? "Per quarter", description: T.quarterlyAuditDesc ?? "Regular audit service" },
    { icon: Users, name: T.teamAlerts ?? "Team Alerts", price: 29, priceType: T.perMonth ?? "Per month", description: T.teamAlertsDesc ?? "Alert your team" },
  ];

  return (
    <section id="pricing" className="py-6 relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-foreground mb-4">
            {T.pricingTitle ?? "Pricing"} <span className="text-primary">{T.pricingTitleHighlight ?? "Plans"}</span>
          </h2>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative rounded-2xl p-8 flex flex-col h-full transition-all duration-300 border hover:scale-105 hover:z-20 ${
                plan.popular
                  ? "bg-[#0A0A0A] border-primary shadow-[0_0_30px_-10px_rgba(59,130,246,0.5)]"
                  : "bg-[#0A0A0A] border-white/10 hover:border-white/20"
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-primary text-white px-4 py-1 rounded-full text-sm font-bold flex items-center gap-1">
                  <Zap className="w-4 h-4" /> {t.mostPopular}
                </div>
              )}
              <div className="mb-4">
                <h3 className="text-xl font-bold text-white mb-1">{plan.name}</h3>
                <p className="text-xs text-slate-400 leading-tight">
                  {plan.description}
                </p>
              </div>
              <div className="mb-6 text-4xl font-bold text-white">
                ${plan.price}<span className="text-sm text-muted-foreground font-normal">{t.perMonth}</span>
              </div>
              <ul className="space-y-4 mb-8 flex-1">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Check className="w-4 h-4 text-primary" /> {f}
                  </li>
                ))}
              </ul>
              <Button
                className="w-full bg-primary hover:bg-blue-600 text-white font-semibold py-6 text-lg"
                onClick={() => handleGetStarted(plan.name)}
                disabled={loadingPlan === planKeyMap[plan.name]}
              >
                {loadingPlan === planKeyMap[plan.name] ? "..." : T.getStarted ?? "Get Started"}
              </Button>
            </div>
          ))}
        </div>

        <div className="mt-24">
          <h3 className="text-2xl font-bold text-center mb-12">{t.addOnsTitle}</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {addons.map((addon) => (
              <div key={addon.name} className="glass rounded-2xl p-6 border border-white/10 hover:border-primary/50 transition-all group flex flex-col">
                <addon.icon className="w-8 h-8 text-primary mb-4" />
                <h4 className="font-bold text-lg mb-1">{addon.name}</h4>
                <div className="text-2xl font-bold mb-3">
                  ${addon.price}
                  <span className="text-sm font-normal text-muted-foreground"> {addon.priceType}</span>
                </div>
                <p className="text-sm text-muted-foreground mb-6 flex-1">{addon.description}</p>
                <Button variant="outline" className="w-full mt-auto group-hover:bg-primary group-hover:text-white group-hover:border-primary transition-all">
                  Order Service <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}