"use client";

import { Button } from "@/components/ui/button";
import { Calculator, Play, ArrowRight, Sparkles } from "lucide-react";
import { useLanguage } from "@/lib/translations";

interface HeroSectionProps {
  onOpenCalculator: () => void;
  onOpenDemo: () => void;
}

export function HeroSection({ onOpenCalculator, onOpenDemo }: HeroSectionProps) {
  const { t } = useLanguage();

  return (
    <section className="relative min-h-screen flex items-center justify-center pt-8 sm:pt-20 px-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-64 sm:w-96 h-64 sm:h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-48 sm:w-80 h-48 sm:h-80 bg-primary/5 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-secondary/80 rounded-full mb-4">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-xs text-muted-foreground">{t.trustedBy}</span>
        </div>

        <h1 className="text-3xl sm:text-7xl font-bold tracking-tight mb-3">
          <span className="text-foreground">{t.heroTitle1}</span>
          <br />
          <span className="text-primary">{t.heroTitle2}</span>
        </h1>

        <p className="text-base sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-6 leading-relaxed">
          {t.heroSubtitle}
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button
            size="lg"
            className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-base font-medium glow-blue"
            onClick={onOpenCalculator}
          >
            <Calculator className="w-5 h-5 mr-2" />
            {t.calculateLosses}
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>

          <Button
            size="lg"
            variant="secondary"
            className="w-full sm:w-auto bg-secondary hover:bg-secondary/80 text-foreground px-8 py-6 text-base font-medium"
            onClick={onOpenDemo}
          >
            <Play className="w-5 h-5 mr-2" />
            {t.watchDemo}
          </Button>
        </div>
      </div>
    </section>
  );
}