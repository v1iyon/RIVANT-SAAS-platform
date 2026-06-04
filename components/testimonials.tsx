"use client";

import { Star, Quote } from "lucide-react";
import { useLanguage } from "@/lib/translations";

export function Testimonials() {
  const { t } = useLanguage();
  
  // Приводим к any, чтобы TypeScript не ругался на структуру массива, если ты не хочешь создавать сложный интерфейс
  const T = t as any; 

  return (
    <section className="py-8 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            {T.testimonialsTitle}
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            {T.testimonialsSubtitle}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {T.testimonials.map((item: any, index: number) => (
            <div
              key={index}
              className="glass rounded-2xl p-8 flex flex-col h-full group hover:bg-white/[0.08] transition-all duration-300"
            >
              <Quote className="w-10 h-10 text-primary/30 mb-4" />
              <p className="text-muted-foreground leading-relaxed flex-1 mb-6">
                &ldquo;{item.content}&rdquo;
              </p>

              <div className="flex gap-1 mb-6">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                ))}
              </div>

              <div className="glass-strong rounded-xl p-4 mb-6">
                <div className="text-2xl font-bold text-primary">{item.metric || "N/A"}</div>
                <div className="text-sm text-muted-foreground">{item.metricLabel}</div>
              </div>

              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-sm font-semibold text-primary">
                    {item.name.split(' ').map((n: string) => n[0]).join('')}
                  </span>
                </div>
                <div>
                  <div className="font-medium text-foreground">{item.name}</div>
                  <div className="text-sm text-muted-foreground">{item.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}