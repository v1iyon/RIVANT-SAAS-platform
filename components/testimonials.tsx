"use client";

import { Star, Quote } from "lucide-react";

const testimonials = [
  {
    name: "Sarah Chen",
    role: "CEO, TechFlow Inc",
    content:
      "PulseOps found $47,000 in monthly losses we didn't know we had. The ROI was instant and the team couldn't believe the insights we'd been missing.",
    metric: "+340%",
    metricLabel: "Operational ROI",
    avatar: "SC",
  },
  {
    name: "Marcus Rodriguez",
    role: "CFO, GrowthStack",
    content:
      "We replaced 6 different tools with PulseOps. Now I get a single dashboard that tells me exactly where we're leaking money and how to fix it.",
    metric: "$127K",
    metricLabel: "Annual Savings",
    avatar: "MR",
  },
  {
    name: "Emily Watson",
    role: "Operations Director, ScaleUp",
    content:
      "The Telegram alerts are a game-changer. I caught a Meta Ads overspend within minutes that would have cost us $15K if left unchecked.",
    metric: "15 min",
    metricLabel: "Issue Response Time",
    avatar: "EW",
  },
];

export function Testimonials() {
  return (
    <section className="py-24 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            Real Results from <span className="text-primary">Real Businesses</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Join hundreds of companies that have transformed their operational visibility
            and stopped silent profit leaks.
          </p>
        </div>

        {/* Testimonial Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {testimonials.map((testimonial, index) => (
            <div
              key={testimonial.name}
              className="glass rounded-2xl p-8 flex flex-col h-full group hover:bg-white/[0.08] transition-all duration-300"
              style={{
                animationDelay: `${index * 100}ms`,
              }}
            >
              {/* Quote Icon */}
              <Quote className="w-10 h-10 text-primary/30 mb-4" />

              {/* Content */}
              <p className="text-muted-foreground leading-relaxed flex-1 mb-6">
                &ldquo;{testimonial.content}&rdquo;
              </p>

              {/* Stars */}
              <div className="flex gap-1 mb-6">
                {[...Array(5)].map((_, i) => (
                  <Star
                    key={i}
                    className="w-4 h-4 text-yellow-500 fill-yellow-500"
                  />
                ))}
              </div>

              {/* Metric */}
              <div className="glass-strong rounded-xl p-4 mb-6">
                <div className="text-2xl font-bold text-primary">
                  {testimonial.metric}
                </div>
                <div className="text-sm text-muted-foreground">
                  {testimonial.metricLabel}
                </div>
              </div>

              {/* Author */}
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-sm font-semibold text-primary">
                    {testimonial.avatar}
                  </span>
                </div>
                <div>
                  <div className="font-medium text-foreground">
                    {testimonial.name}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {testimonial.role}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
