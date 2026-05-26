"use client";

import { Button } from "@/components/ui/button";
import { Check, Zap, Settings, FileText, Users } from "lucide-react";

const plans = [
  {
    name: "Starter",
    price: 49,
    description: "Perfect for small teams just getting started with visibility.",
    features: [
      "Revenue tracking dashboard",
      "3 platform integrations",
      "Weekly email reports",
      "Basic analytics",
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
      "Everything in Starter",
      "Real-time Telegram alerts",
      "Margin analysis tools",
      "AI-powered insights",
      "Unlimited integrations",
      "90-day data retention",
      "Priority support",
      "Custom dashboards",
    ],
    cta: "Start Free Trial",
    popular: true,
  },
  {
    name: "Scale",
    price: 349,
    description: "Enterprise-grade visibility for larger organizations.",
    features: [
      "Everything in Growth",
      "Custom forecasting models",
      "Multi-business management",
      "Dedicated account manager",
      "API access",
      "Unlimited data retention",
      "White-label options",
      "SOC 2 compliance",
    ],
    cta: "Contact Sales",
    popular: false,
  },
];

const addons = [
  {
    icon: Settings,
    name: "Business Setup Fee",
    price: 199,
    priceType: "one-time",
    description: "End-to-end integration by our experts. We connect all your data sources and configure custom alerts.",
  },
  {
    icon: FileText,
    name: "Quarterly Audit",
    price: 299,
    priceType: "per audit",
    description: "Deep-dive operational report with actionable recommendations from our analytics team.",
  },
  {
    icon: Users,
    name: "Team Alert Access",
    price: 29,
    priceType: "/mo per seat",
    description: "Add extra teammates to receive Telegram alerts and access the dashboard.",
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="py-24 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4 text-balance">
            Simple, Transparent <span className="text-primary">Pricing</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Choose the plan that fits your business. All plans include a 14-day free trial.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative rounded-2xl p-6 lg:p-8 flex flex-col h-full transition-all duration-300 ${
                plan.popular
                  ? "glass-strong glow-blue scale-100 lg:scale-[1.02] z-10"
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
                    ${plan.price}
                  </span>
                  <span className="text-muted-foreground">/month</span>
                </div>
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

        {/* Professional Add-ons Section */}
        <div className="mt-20">
          <div className="text-center mb-12">
            <h3 className="text-2xl font-bold text-foreground mb-3">
              Professional Add-ons
            </h3>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Enhance your PulseOps experience with expert services and additional capabilities.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {addons.map((addon) => (
              <div
                key={addon.name}
                className="glass rounded-xl p-6 hover:bg-white/[0.08] transition-all duration-300 group"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                    <addon.icon className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-foreground mb-1">{addon.name}</h4>
                    <div className="flex items-baseline gap-1 mb-2">
                      <span className="text-xl font-bold text-foreground">${addon.price}</span>
                      <span className="text-sm text-muted-foreground">{addon.priceType}</span>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {addon.description}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Money Back Guarantee */}
        <div className="text-center mt-12">
          <p className="text-sm text-muted-foreground">
            30-day money-back guarantee | No credit card required for trial |
            Cancel anytime
          </p>
        </div>
      </div>
    </section>
  );
}
