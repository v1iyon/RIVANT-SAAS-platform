"use client";

import { Button } from "@/components/ui/button";
import { Calculator, Play, ArrowRight, Sparkles } from "lucide-react";

interface HeroSectionProps {
  onOpenCalculator: () => void;
  onOpenDemo: () => void;
}

export function HeroSection({ onOpenCalculator, onOpenDemo }: HeroSectionProps) {
  return (
    <section className="relative min-h-screen flex items-center justify-center pt-20 overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-primary/5 rounded-full blur-3xl animate-pulse delay-1000" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-radial from-primary/5 to-transparent rounded-full" />
      </div>

      {/* Grid Pattern Overlay */}
      <div 
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: '60px 60px'
        }}
      />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 glass rounded-full mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm text-muted-foreground">
            Trusted by 500+ growing businesses
          </span>
        </div>

        {/* Main Headline */}
        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-6 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
          <span className="text-foreground">Most businesses lose</span>
          <br />
          <span className="text-primary">profit silently.</span>
        </h1>

        {/* Subheadline */}
        <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200">
          PulseOps reveals hidden losses before they become expensive. 
          Get real-time visibility into your business operations and stop bleeding money.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
          <Button
            size="lg"
            className="group bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-base font-medium glow-blue"
            onClick={onOpenCalculator}
          >
            <Calculator className="w-5 h-5 mr-2" />
            Calculate Hidden Losses
            <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
          </Button>
          
          <Button
            size="lg"
            variant="outline"
            className="group glass border-border/50 hover:bg-white/5 px-8 py-6 text-base font-medium"
            onClick={onOpenDemo}
          >
            <Play className="w-5 h-5 mr-2" />
            Watch Live Demo
          </Button>
        </div>

        {/* Social Proof */}
        <div className="mt-16 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-500">
          <p className="text-sm text-muted-foreground mb-6">
            Powering financial clarity for industry leaders
          </p>
          <div className="flex items-center justify-center gap-8 opacity-50">
            {["Acme Corp", "Globex", "Initech", "Umbrella", "Stark"].map((company) => (
              <span
                key={company}
                className="text-sm font-medium text-muted-foreground tracking-wide"
              >
                {company}
              </span>
            ))}
          </div>
        </div>

        {/* Scroll Indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <div className="w-6 h-10 rounded-full border-2 border-border/50 flex items-start justify-center p-2">
            <div className="w-1.5 h-3 bg-primary rounded-full animate-pulse" />
          </div>
        </div>
      </div>
    </section>
  );
}
