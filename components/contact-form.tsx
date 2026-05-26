"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Send, CheckCircle } from "lucide-react";

export function ContactForm() {
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    company: "",
    email: "",
    telegram: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Simulate form submission
    setIsSubmitted(true);
    setTimeout(() => {
      setIsSubmitted(false);
      setFormData({ name: "", company: "", email: "", telegram: "" });
    }, 3000);
  };

  return (
    <section id="contact" className="py-24 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left Side - Content */}
          <div>
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              Ready to Stop <span className="text-primary">Losing Money?</span>
            </h2>
            <p className="text-muted-foreground mb-8 leading-relaxed">
              Get a personalized demo and see exactly how much your business could
              save with PulseOps. Our team will analyze your current setup and show
              you where you&apos;re leaking profits.
            </p>

            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-primary font-bold">1</span>
                </div>
                <div>
                  <h4 className="font-medium text-foreground mb-1">
                    Book a 15-minute call
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Quick intro to understand your business needs
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-primary font-bold">2</span>
                </div>
                <div>
                  <h4 className="font-medium text-foreground mb-1">
                    Get a custom analysis
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    We&apos;ll identify your specific loss areas
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-primary font-bold">3</span>
                </div>
                <div>
                  <h4 className="font-medium text-foreground mb-1">
                    Start saving money
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    See results within the first week
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Side - Form */}
          <div className="glass rounded-2xl p-8">
            {isSubmitted ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
                  <CheckCircle className="w-8 h-8 text-green-500" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  Thank you!
                </h3>
                <p className="text-muted-foreground">
                  We&apos;ll be in touch within 24 hours.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <Input
                    id="name"
                    placeholder="John Smith"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    required
                    className="bg-input border-border focus:border-primary"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="company">Company Name</Label>
                  <Input
                    id="company"
                    placeholder="Acme Inc"
                    value={formData.company}
                    onChange={(e) =>
                      setFormData({ ...formData, company: e.target.value })
                    }
                    required
                    className="bg-input border-border focus:border-primary"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Work Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="john@acme.com"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                    required
                    className="bg-input border-border focus:border-primary"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="telegram">
                    Telegram Username{" "}
                    <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="telegram"
                    placeholder="@username"
                    value={formData.telegram}
                    onChange={(e) =>
                      setFormData({ ...formData, telegram: e.target.value })
                    }
                    className="bg-input border-border focus:border-primary"
                  />
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Request Demo
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                  By submitting, you agree to our Privacy Policy and Terms of Service.
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
