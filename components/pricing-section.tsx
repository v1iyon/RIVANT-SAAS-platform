"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { loadPaddle, openPaddleCheckout } from "@/lib/paddle-client";
import PaymentModal from "@/components/PaymentModal";
import { Button } from "@/components/ui/button";
import { Check, Zap, FileText, Users, ArrowRight } from "lucide-react";
import { useLanguage, type Language } from "@/lib/translations";
import { useCurrency } from "@/lib/currency";
import { commonError } from "@/lib/error-messages";

type Plan = {
  name: string;
  price: number;
  description: string;
  features: string[];
  popular: boolean;
};

export function PricingSection() {
  const { t, language } = useLanguage();
  const T = t as any;
  const { formatPrice } = useCurrency();
  const supabase = createClient();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  // Keys here must match public.plans.id exactly — that's what gets sent
  // to create-order, which looks up the real price server-side.
  // Must match public.plans.id exactly ("premium", not "scale" — the
  // display label is "Scale" but the DB row's id is "premium").
  const planKeyMap: Record<string, string> = {
    [T.starter ?? "Starter"]: "starter",
    [T.growth ?? "Growth"]: "growth",
    [T.scale ?? "Scale"]: "premium",
  };

  // Site language (EN | UA | DE, see lib/translations.tsx) -> PaymentModal's
  // locale codes (en | uk | de). PaymentModal auto-detects from this — no
  // manual language buttons inside the payment flow anymore.
  const LANGUAGE_TO_MODAL_LOCALE: Record<Language, "en" | "uk" | "de"> = {
    EN: "en",
    UA: "uk",
    DE: "de",
  };

  const [paymentPlan, setPaymentPlan] = useState<"starter" | "growth" | "premium" | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const handleGetStarted = async (planName: string) => {
    const planKey = planKeyMap[planName] as "starter" | "growth" | "premium";
    setLoadingPlan(planKey);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        window.dispatchEvent(new CustomEvent("rivant:open-signup"));
        return;
      }
      setUserId(data.session.user.id);
      setPaymentPlan(planKey);
    } catch (e) {
      console.error("session check error:", e);
      alert(commonError("paymentWindowFailed", language));
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

  const [orderingService, setOrderingService] = useState<string | null>(null);

  // Ko-fi Shop Item links for add-ons. kofi-webhook matches these by
  // direct_link_code (the part after /s/) — see DIRECT_LINK_CODE_TO_ADDON
  // in supabase/functions/kofi-webhook/index.ts. If you regenerate a Shop
  // Item link in Ko-fi, its code changes and BOTH places need updating.
  const ADDON_KOFI_LINKS: Record<string, string> = {
    whatif_analysis: "https://ko-fi.com/s/41ec6cf444", // AI Historical Analysis
    monthly_digest: "https://ko-fi.com/s/cfa88bffb3", // AI Performance Digest
    team_alerts: "https://ko-fi.com/s/a6db84895c", // Team Alert Access
  };

  const handleOrderService = async (serviceType: string) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      window.dispatchEvent(new CustomEvent("rivant:open-signup"));
      return;
    }

    const kofiLink = ADDON_KOFI_LINKS[serviceType];
    if (kofiLink) {
      // Same centered-popup pattern as PaymentModal.handleKofiPay, so this
      // reads as a checkout modal over RIVANT rather than a full navigation
      // away. kofi-webhook creates the service_order/addon_subscription row
      // as soon as payment lands — no need to call /api/orders/create here.
      setOrderingService(serviceType);
      const w = 480;
      const h = 720;
      const left = window.screenX + (window.outerWidth - w) / 2;
      const top = window.screenY + (window.outerHeight - h) / 2;
      const popup = window.open(
        kofiLink,
        "rivant_checkout",
        `width=${w},height=${h},left=${left},top=${top},resizable=no,scrollbars=yes`,
      );
      if (!popup) {
        window.open(kofiLink, "_blank", "noopener,noreferrer");
      }
      setOrderingService(null);
      return;
    }

    // Fallback for any service without a Ko-fi link yet (e.g. business_setup,
    // which stays on the calendar-booking / Paddle route below).
    setOrderingService(serviceType);
    try {
      const res = await fetch("/api/orders/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.session.user.email, serviceType }),
      });
      const result = await res.json();

      if (result.mode === "redirect") {
        window.location.href = result.url; // e.g. business_setup -> calendar booking
      } else if (result.mode === "checkout") {
        await loadPaddle();
        openPaddleCheckout({ priceId: result.priceId, email: data.session.user.email!, plan: serviceType });
      } else {
        // lead_captured — payment not wired up yet, request already sent to you via Telegram
        window.location.href = "/dashboard?order=received";
      }
    } catch (e) {
      console.error("order create error:", e);
      alert(commonError("requestFailed", language));
    } finally {
      setOrderingService(null);
    }
  };

  // "Business setup" was replaced with an automated What-If service, and
  // "Quarterly audit" with a cheaper monthly digest from the same engine
  // (both fully automated, no human involved). "Team alerts" stays, and is
  // now actually wired to /api/team/invite.
  const addons = [
    { icon: FileText, key: "whatif_analysis", name: T.whatifAnalysis ?? "AI Historical Analysis", price: 199, priceType: T.oneTime ?? "One-time", description: T.whatifAnalysisDesc ?? "Automated analysis of your last 12 months of data" },
    { icon: Zap, key: "monthly_digest", name: T.monthlyDigest ?? "AI Performance Digest", price: 49, priceType: T.perMonth ?? "Per month", description: T.monthlyDigestDesc ?? "Automated monthly snapshot of your key metrics" },
    { icon: Users, key: "team_alerts", name: T.teamAlerts ?? "Team Alert Access", price: 29, priceType: T.perMonth ?? "Per month", description: T.teamAlertsDesc ?? "Enable real-time Telegram alerts for your team" },
  ];

  return (
   <section className="py-6 relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-6">
          <h2 className="text-4xl font-bold text-foreground mb-4">
            {T.pricingTitle ?? "Pricing"} <span className="text-primary">{T.pricingTitleHighlight ?? "Plans"}</span>
          </h2>
        </div>

        {/* Pricing Cards */}
        <div id="pricing" className="grid grid-cols-1 md:grid-cols-3 gap-8 scroll-mt-24">
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
                {formatPrice(plan.price)}<span className="text-sm text-muted-foreground font-normal">{t.perMonth}</span>
              </div>
              <div className="mb-2">
                <ul className="space-y-4">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
                      <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" /> {f}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex-1 flex items-center">
                {plan.name === (T.growth ?? "Growth") && T.growthLockNote && (
                  <p className="text-[11px] text-slate-500 leading-snug mb-3">{T.growthLockNote}</p>
                )}
              </div>
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

        <div className="mt-12">
          <h3 className="text-2xl font-bold text-center mb-12">{t.addOnsTitle}</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {addons.map((addon) => (
              <div key={addon.name} className="glass rounded-2xl p-6 border border-white/10 hover:border-primary/50 transition-all group flex flex-col">
                <addon.icon className="w-8 h-8 text-primary mb-4" />
                <h4 className="font-bold text-lg mb-1">{addon.name}</h4>
                <div className="text-2xl font-bold mb-3">
                  {formatPrice(addon.price, "addon")}
                  <span className="text-sm font-normal text-muted-foreground"> {addon.priceType}</span>
                </div>
                <p className="text-sm text-muted-foreground mb-6 flex-1">{addon.description}</p>
                <Button
                  variant="outline"
                  className="w-full mt-auto group-hover:bg-primary group-hover:text-white group-hover:border-primary transition-all"
                  onClick={() => handleOrderService(addon.key)}
                  disabled={orderingService === addon.key}
                >
  {orderingService === addon.key ? "..." : (t.orderService || "Order Service")} <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
</Button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {paymentPlan && userId && (
        <PaymentModal
          isOpen={!!paymentPlan}
          onClose={() => setPaymentPlan(null)}
          locale={LANGUAGE_TO_MODAL_LOCALE[language]}
          userId={userId}
          initialPlan={paymentPlan}
          onActivated={() => {
            window.location.href = "/dashboard?checkout=success";
          }}
        />
      )}
    </section>
  );
}