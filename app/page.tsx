"use client";

import { useState, useRef, useEffect } from "react";
import { Navbar } from "@/components/navbar";
import { HeroSection } from "@/components/hero-section";
import { LossCalculator } from "@/components/loss-calculator";
import { ProblemSolutionGrid } from "@/components/problem-solution-grid";
import { Testimonials } from "@/components/testimonials";
import { PricingSection } from "@/components/pricing-section";
import { ContactForm } from "@/components/contact-form";
import { Footer } from "@/components/footer";
import { LiveDemoModal } from "@/components/live-demo-modal";

export default function Home() {
  const [isDemoOpen, setIsDemoOpen] = useState(false);
  const calculatorRef = useRef<HTMLDivElement>(null);

  const handleOpenCalculator = () => {
    calculatorRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleOpenDemo = () => setIsDemoOpen(true);
  const handleCloseDemo = () => setIsDemoOpen(false);

  useEffect(() => {
    const rawHash = window.location.hash;
    if (!rawHash) return;

    // "#pricing#pricing" -> "pricing" (берём только первый валидный сегмент)
    const id = rawHash.slice(1).split("#")[0];
    if (!id) return;

    let cancelled = false;

    const scrollToTarget = () => {
      const el = document.getElementById(id);
      if (!el) return false;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      return true;
    };

    // Ждём полной загрузки страницы (картинки, шрифты и т.п.),
    // затем даём ещё один кадр на стабилизацию layout, и только
    // после этого скроллим. Плюс повторная коррекция через 400мс
    // на случай, если что-то ещё досчиталось после первого скролла.
    const run = () => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (scrollToTarget()) {
          setTimeout(() => {
            if (!cancelled) scrollToTarget();
          }, 400);
        }
      });
    };

    if (document.readyState === "complete") {
      run();
    } else {
      window.addEventListener("load", run, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("load", run);
    };
  }, []);

  return (
    <main className="min-h-screen bg-background">
      <Navbar onOpenDemo={handleOpenDemo} />

      <HeroSection
        onOpenCalculator={handleOpenCalculator}
        onOpenDemo={handleOpenDemo}
      />

      <div ref={calculatorRef}>
        <LossCalculator />
      </div>

      <ProblemSolutionGrid />
      <Testimonials />
      <PricingSection />
      <ContactForm />
      <Footer />

      <LiveDemoModal isOpen={isDemoOpen} onClose={() => setIsDemoOpen(false)} />
    </main>
  );
}