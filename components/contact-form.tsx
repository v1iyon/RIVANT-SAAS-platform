"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Send, CheckCircle } from "lucide-react";
import { useLanguage } from "@/lib/translations";

export function ContactForm() {
  const { t } = useLanguage();
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    company: "",
    email: "",
    telegram: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    setIsSubmitted(true);
    setTimeout(() => {
      setIsSubmitted(false);
      setFormData({ name: "", company: "", email: "", telegram: "" });
    }, 3000);
  };

  return (
    <section id="contact" className="py-8 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div>
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              {t.readyToStop}
            </h2>
            <p className="text-muted-foreground mb-8 leading-relaxed">
              {t.readyToStopDesc}
            </p>

            <div className="space-y-6">
  {[
    { n: "1", title: t.step1, desc: t.step1Desc },
    { n: "2", title: t.step2, desc: t.step2Desc },
    { n: "3", title: t.step3, desc: t.step3Desc },
  ].map((step) => (
    <div key={step.n} className="flex items-start gap-4">
      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <span className="text-primary font-bold">{step.n}</span>
      </div>
      <div>
        <h4 className="font-medium text-foreground mb-1">{step.title}</h4>
        <p className="text-sm text-muted-foreground">{step.desc}</p>
      </div>
    </div>
  ))}
</div>
          </div>

          <div className="glass rounded-2xl p-8">
            {isSubmitted ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
                  <CheckCircle className="w-8 h-8 text-green-500" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">Thank you!</h3>
                <p className="text-muted-foreground">We'll be in touch within 24 hours.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-1">
                  <Label htmlFor="name">Full Name</Label>
                  <Input id="name" placeholder="John Smith" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} required className="bg-input border-border" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company">Company Name</Label>
                  <Input id="company" placeholder="Acme Inc" value={formData.company} onChange={(e) => setFormData({...formData, company: e.target.value})} required className="bg-input border-border" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Work Email</Label>
                  <Input id="email" type="email" placeholder="john@acme.com" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} required className="bg-input border-border" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="telegram">Telegram Username <span className="text-muted-foreground">(optional)</span></Label>
                  <Input id="telegram" placeholder="@username" value={formData.telegram} onChange={(e) => setFormData({...formData, telegram: e.target.value})} className="bg-input border-border" />
                </div>
                <Button type="submit" size="lg" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">
                  <Send className="w-4 h-4 mr-2" />
                  {t.requestDemoBtn}
                </Button>
                <p className="text-xs text-muted-foreground text-center">{t.privacyNotice}</p>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}