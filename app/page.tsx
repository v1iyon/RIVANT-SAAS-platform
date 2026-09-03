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

  // FIX: elementRef.scrollIntoView({block:"start"}) ставит блок калькулятора
  // впритул до самого верху екрана (під навбаром на десктопі це виглядає
  // затиснутим, на мобільному — ще й під фіксованим хедером). Рахуємо
  // позицію самі і скролимо з невеликим відступом зверху — однаково і на
  // телефоні, і на ноуті, замість жорсткого block:"start".
  const handleOpenCalculator = () => {
    const el = calculatorRef.current;
    if (!el) return;
    const offset = window.innerWidth < 1024 ? 72 : 88; // висота фіксованого навбара + невеликий "дихальний" відступ
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: "smooth" });
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
      <PricingSection />
      <Testimonials />
      <ContactForm />
      <Footer />

      <LiveDemoModal isOpen={isDemoOpen} onClose={() => setIsDemoOpen(false)} />
    </main>
  );
}