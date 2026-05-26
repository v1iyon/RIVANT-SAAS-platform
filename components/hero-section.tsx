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
    <section className="relative min-h-screen flex items-center justify-center pt-16 sm:pt-20 overflow-hidden px-4">
      {/* Background Effects */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-64 sm:w-96 h-64 sm:h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-48 sm:w-80 h-48 sm:h-80 bg-primary/5 rounded-full blur-3xl animate-pulse delay-1000" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] sm:w-[800px] h-[400px] sm:h-[800px] bg-gradient-radial from-primary/5 to-transparent rounded-full" />
      </div>

      {/* Grid Pattern Overlay */}
      <div 
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: '60px 60px'
        }}
      />

      <div className="relative z-10 max-w-7xl mx-auto text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 bg-secondary/80 rounded-full mb-6 sm:mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-xs sm:text-sm text-muted-foreground">
            {t.trustedBy}
          </span>
        </div>

        {/* Main Headline - Mobile optimized */}
        <h1 className="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-4 sm:mb-6 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 text-balance">
          <span className="text-foreground">{t.heroTitle1}</span>
          <br />
          <span className="text-primary">{t.heroTitle2}</span>
        </h1>

        {/* Subheadline - Mobile optimized */}
        <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-8 sm:mb-10 leading-relaxed animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200 text-pretty">
          {t.heroSubtitle}
        </p>

        {/* CTA Buttons - Touch friendly */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
          <Button
            size="lg"
            className="w-full sm:w-auto group bg-primary hover:bg-primary/90 text-primary-foreground px-6 sm:px-8 py-6 sm:py-6 text-base font-medium glow-blue"
            onClick={onOpenCalculator}
          >
            <Calculator className="w-5 h-5 mr-2" />
            {t.calculateLosses}
            <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
          </Button>
          
          <Button
            size="lg"
            variant="secondary"
            className="w-full sm:w-auto group bg-secondary hover:bg-secondary/80 text-foreground px-6 sm:px-8 py-6 sm:py-6 text-base font-medium"
            onClick={onOpenDemo}
          >
            <Play className="w-5 h-5 mr-2" />
            {t.watchDemo}
          </Button>
        </div>

        {/* Social Proof */}
        <div className="mt-12 sm:mt-16 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-500">
          <p className="text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6">
            {t.poweringClarity}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-8 opacity-50">
            {["Acme Corp", "Globex", "Initech", "Umbrella", "Stark"].map((company) => (
              <span
                key={company}
                className="text-xs sm:text-sm font-medium text-muted-foreground tracking-wide"
              >
                {company}
              </span>
            ))}
          </div>
        </div>

        {/* Scroll Indicator - Hidden on mobile */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce hidden sm:block">
          <div className="w-6 h-10 rounded-full border-2 border-border/50 flex items-start justify-center p-2">
            <div className="w-1.5 h-3 bg-primary rounded-full animate-pulse" />
          </div>
        </div>
      </div>
    </section>
  );
}
