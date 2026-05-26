"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Zap } from "lucide-react";

const plans = [
  {
    name: "Starter",
    price: 49,
    description: "Perfect for small teams just getting started with visibility.",
    features: [
      "Up to 5 team members",
      "Basic dashboard analytics",
      "Daily email reports",
      "3 integrations",
      "7-day data retention",
      "Email support",
    ],
    cta: "Start Free Trial",
    popular: false,
  },
  {
    name: "Growth",
    price: 149,
    description: "For growing businesses that need real-time insights and alerts.",
    features: [
      "Up to 25 team members",
      "Advanced analytics & forecasting",
      "Real-time Telegram alerts",
      "Unlimited integrations",
      "90-day data retention",
      "Priority support",
      "Custom dashboards",
      "Risk detection AI",
    ],
    cta: "Start Free Trial",
    popular: true,
  },
  {
    name: "Scale",
    price: 349,
    description: "Enterprise-grade visibility for larger organizations.",
    features: [
      "Unlimited team members",
      "Predictive analytics",
      "Custom alert channels",
      "API access",
      "Unlimited data retention",
      "Dedicated account manager",
      "White-label options",
      "SOC 2 compliance",
      "Custom integrations",
    ],
    cta: "Contact Sales",
    popular: false,
  },
];

export function PricingSection() {
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">("monthly");

  const getPrice = (basePrice: number) => {
    if (billingCycle === "annual") {
      return Math.round(basePrice * 0.8); // 20% discount for annual
    }
    return basePrice;
  };

  return (
    <section id="pricing" className="py-24 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            Simple, Transparent <span className="text-primary">Pricing</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto mb-8">
            Choose the plan that fits your business. All plans include a 14-day free trial.
          </p>

          {/* Billing Toggle */}
          <div className="inline-flex items-center gap-3 glass rounded-full p-1">
            <button
              onClick={() => setBillingCycle("monthly")}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                billingCycle === "monthly"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle("annual")}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                billingCycle === "annual"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Annual
              <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
                Save 20%
              </span>
            </button>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative rounded-2xl p-8 flex flex-col h-full transition-all duration-300 ${
                plan.popular
                  ? "glass-strong glow-blue scale-[1.02] z-10"
                  : "glass hover:bg-white/[0.08]"
              }`}
            >
              {/* Popular Badge */}
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <div className="flex items-center gap-1 bg-primary text-primary-foreground px-4 py-1 rounded-full text-sm font-medium">
                    <Zap className="w-4 h-4" />
                    Most Popular
                  </div>
                </div>
              )}

              {/* Plan Header */}
              <div className="mb-6">
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  {plan.name}
                </h3>
                <p className="text-sm text-muted-foreground">{plan.description}</p>
              </div>

              {/* Price */}
              <div className="mb-6">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-foreground">
                    ${getPrice(plan.price)}
                  </span>
                  <span className="text-muted-foreground">/month</span>
                </div>
                {billingCycle === "annual" && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Billed annually (${getPrice(plan.price) * 12}/year)
                  </p>
                )}
              </div>

              {/* Features */}
              <ul className="space-y-3 mb-8 flex-1">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm text-muted-foreground">{feature}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <Button
                className={`w-full ${
                  plan.popular
                    ? "bg-primary hover:bg-primary/90 text-primary-foreground"
                    : "bg-secondary hover:bg-secondary/80 text-secondary-foreground"
                }`}
                size="lg"
              >
                {plan.cta}
              </Button>
            </div>
          ))}
        </div>

        {/* Money Back Guarantee */}
        <div className="text-center mt-12">
          <p className="text-sm text-muted-foreground">
            30-day money-back guarantee • No credit card required for trial •
            Cancel anytime
          </p>
        </div>
      </div>
    </section>
  );
}
