"use client";

import Link from "next/link";
import { Mail, Send } from "lucide-react";
import { Linkedin } from "lucide-react";
import { useLanguage } from "@/lib/translations";

export function Footer() {
  const { t } = useLanguage();

  const footerLinks = {
    main: [
      { name: "About", href: "#about" },
      { name: "Pricing", href: "#pricing" },
      { name: "Contact", href: "#contact" },
    ],
    social: [
      { name: "Telegram", href: "https://t.me/official_rivant", icon: Send },
      { name: "LinkedIn", href: "#", icon: Linkedin },
      { name: "Email", href: "mailto:official.rivant@gmail.com", icon: Mail },
    ],
    legal: [
      { name: "Privacy Policy", href: "/privacy" },
      { name: "Terms of Service", href: "/terms" },
      { name: "Refund Policy", href: "/refund-policy" },
      { name: "Cookie Policy", href: "/cookies" },
    ],
  };

  // Плавная прокрутка для якорных ссылок
  const handleSmoothScroll = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (href.startsWith("#")) {
      e.preventDefault();
      const element = document.querySelector(href);
      if (element) {
        element.scrollIntoView({ behavior: "smooth" });
      }
    }
  };

  return (
    <footer className="py-4 border-t border-border/40">
      <div className="px-6 md:px-12 lg:px-20">
        
        {/* Первый ряд */}
        <div className="flex flex-wrap justify-between items-center gap-y-3">
          {/* Левая часть: RIVANT + описание */}
          <div className="flex flex-col gap-0.5">
            <Link href="/" className="flex items-center gap-1">
              <img src="/icon.png" alt="RIVANT" className="w-4 h-4" />
              <span className="text-xs font-semibold">RIVANT</span>
            </Link>
            <p className="text-[10px] text-muted-foreground">
              Reveal hidden losses — real-time visibility for growing companies.
            </p>
          </div>

          {/* Центр: About, Pricing, Contact */}
          <div className="flex gap-5">
            {footerLinks.main.map((link) => (
              <Link
                key={link.name}
                href={link.href}
                onClick={(e) => handleSmoothScroll(e, link.href)}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {link.name}
              </Link>
            ))}
          </div>

          {/* Правая часть: иконки соцсетей */}
         <div className="flex gap-2 mt-1 sm:mt-0">
  {footerLinks.social.map((link) => (
              <Link
                key={link.name}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground/50 hover:text-foreground transition-colors"
              >
                <link.icon className="w-3.5 h-3.5" />
              </Link>
            ))}
          </div>
        </div>

        {/* Второй ряд */}
        <div className="mt-3 pt-2 border-t border-border/30 flex justify-between items-center text-[9px] text-muted-foreground/50">
          <div className="flex gap-2">
            <span>© {new Date().getFullYear()} RIVANT</span>
            <span>•</span>
            <span>Built with precision</span>
          </div>
          <div className="flex gap-4">
            {footerLinks.legal.map((link) => (
              <Link key={link.name} href={link.href} className="hover:text-muted-foreground transition-colors">
                {link.name}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}