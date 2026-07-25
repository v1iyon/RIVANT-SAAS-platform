"use client";

import { useState, useEffect, useRef } from "react";
import { Star, Quote, ChevronLeft, ChevronRight } from "lucide-react";
import { useLanguage } from "@/lib/translations";

interface Review {
  author_name: string;
  business_name: string | null;
  rating: number;
  comment: string;
}

export function Testimonials() {
  const { t, language } = useLanguage();
  const T = t as any;
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    fetch("/api/reviews")
      .then((r) => r.json())
      .then((data) => setReviews(data.reviews || []))
      .finally(() => setLoading(false));
  }, []);

  const updateScrollButtons = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  useEffect(() => {
    updateScrollButtons();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateScrollButtons);
    window.addEventListener("resize", updateScrollButtons);
    return () => {
      el.removeEventListener("scroll", updateScrollButtons);
      window.removeEventListener("resize", updateScrollButtons);
    };
  }, [reviews]);

  const scrollByCards = (direction: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    const card = el.querySelector("[data-review-card]") as HTMLElement | null;
    const distance = card ? card.offsetWidth + 24 : 360;
    el.scrollBy({ left: direction * distance, behavior: "smooth" });
  };

  if (loading) return null;

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

        {reviews.length === 0 ? (
          <div className="text-center py-12">
            <Quote className="w-10 h-10 text-primary/30 mx-auto mb-4" />
            <p className="text-muted-foreground">
              {language === "UA"
                ? "Станьте першими, хто поділиться своїм досвідом використання RIVANT."
                : language === "DE"
                ? "Seien Sie der Erste, der seine Erfahrung mit RIVANT teilt."
                : "Be the first to share your experience with RIVANT."}
            </p>
          </div>
        ) : (
          <div className="relative">
            {canScrollLeft && (
              <button
                onClick={() => scrollByCards(-1)}
                aria-label="Previous reviews"
                className="hidden sm:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-5 z-10 w-10 h-10 rounded-full border border-white/10 bg-background items-center justify-center text-muted-foreground hover:text-foreground hover:border-white/30 transition-colors shadow-lg"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            {canScrollRight && (
              <button
                onClick={() => scrollByCards(1)}
                aria-label="Next reviews"
                className="hidden sm:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-5 z-10 w-10 h-10 rounded-full border border-white/10 bg-background items-center justify-center text-muted-foreground hover:text-foreground hover:border-white/30 transition-colors shadow-lg"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}

            <div
              ref={scrollRef}
              className={`flex gap-6 overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-smooth pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 ${
                !canScrollLeft && !canScrollRight ? "justify-center" : ""
              }`}
            >
              {reviews.map((item, index) => (
                <div
                  key={index}
                  data-review-card
                  className="glass rounded-2xl p-8 flex flex-col shrink-0 w-[300px] sm:w-[360px] snap-start group hover:bg-white/[0.08] transition-all duration-300"
                >
                  <Quote className="w-10 h-10 text-primary/30 mb-4" />
                  <p className="text-muted-foreground leading-relaxed flex-1 mb-6">
                    &ldquo;{item.comment}&rdquo;
                  </p>

                  <div className="flex gap-1 mb-6">
                    {[...Array(5)].map((_, i) => (
                      <Star
                        key={i}
                        className={`w-4 h-4 ${i < item.rating ? "text-yellow-500 fill-yellow-500" : "text-gray-700"}`}
                      />
                    ))}
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-sm font-semibold text-primary">
                        {item.author_name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </span>
                    </div>
                    <div>
                      <div className="font-medium text-foreground">{item.author_name}</div>
                      {item.business_name && (
                        <div className="text-sm text-muted-foreground">{item.business_name}</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}