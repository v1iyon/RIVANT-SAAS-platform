"use client";

import { useState, useRef } from "react";
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

  const handleOpenDemo = () => {
    setIsDemoOpen(true);
  };

  const handleCloseDemo = () => {
    setIsDemoOpen(false);
  };

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

      <LiveDemoModal isOpen={isDemoOpen} onClose={() => setIsDemoOpen(false)}
      />
    </main>
  );
}