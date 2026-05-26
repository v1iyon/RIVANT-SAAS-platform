"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Menu, X, ChevronDown, Activity, Globe, ShoppingCart, Truck, UtensilsCrossed } from "lucide-react";
import { useLanguage, Language } from "@/lib/translations";

const languages: { code: Language; label: string }[] = [
  { code: "EN", label: "English" },
  { code: "UA", label: "Українська" },
  { code: "DE", label: "Deutsch" },
];

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { language, setLanguage, t } = useLanguage();

  const solutions = [
    {
      icon: ShoppingCart,
      name: t.ecommerce,
      description: t.ecommerceDesc,
      href: "#calculator",
    },
    {
      icon: Truck,
      name: t.logistics,
      description: t.logisticsDesc,
      href: "#calculator",
    },
    {
      icon: UtensilsCrossed,
      name: t.hospitality,
      description: t.hospitalityDesc,
      href: "#calculator",
    },
  ];

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled
          ? "bg-background/95 backdrop-blur-xl border-b border-border/50 py-3"
          : "bg-transparent py-4"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Activity className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-semibold text-foreground">
              PulseOps
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center gap-8">
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1 text-sm font-medium text-foreground bg-secondary/80 hover:bg-secondary px-4 py-2 rounded-lg transition-colors">
                {t.solutions} <ChevronDown className="w-4 h-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="bg-popover border-border w-80 p-2">
                {solutions.map((solution) => (
                  <DropdownMenuItem 
                    key={solution.name} 
                    className="focus:bg-primary/10 rounded-lg p-3 cursor-pointer"
                    asChild
                  >
                    <Link href={solution.href} className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <solution.icon className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <div className="font-medium text-foreground">{solution.name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                          {solution.description}
                        </div>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Link
              href="#features"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {t.about}
            </Link>

            <Link
              href="#pricing"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {t.pricing}
            </Link>

            <Link
              href="#contact"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {t.contact}
            </Link>
          </div>

          {/* Desktop CTA Buttons */}
          <div className="hidden lg:flex items-center gap-3">
            {/* Language Switcher */}
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1.5 text-sm font-medium text-foreground bg-secondary/80 hover:bg-secondary px-3 py-2 rounded-lg transition-colors">
                <Globe className="w-4 h-4" />
                {language}
                <ChevronDown className="w-3 h-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="bg-popover border-border">
                {languages.map((lang) => (
                  <DropdownMenuItem 
                    key={lang.code}
                    onClick={() => setLanguage(lang.code)}
                    className={`focus:bg-primary/10 cursor-pointer ${
                      language === lang.code ? "text-primary bg-primary/5" : ""
                    }`}
                  >
                    {lang.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Link href="/app">
              <Button variant="secondary" className="text-sm font-medium bg-secondary hover:bg-secondary/80">
                {t.cabinet}
              </Button>
            </Link>
            <Button className="text-sm font-medium bg-primary hover:bg-primary/90 text-primary-foreground">
              {t.bookDemo}
            </Button>
          </div>

          {/* Mobile Menu Button */}
          <button
            className="lg:hidden text-foreground p-2 bg-secondary rounded-lg hover:bg-secondary/80 transition-colors"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
          >
            {isMobileMenuOpen ? (
              <X className="w-6 h-6" />
            ) : (
              <Menu className="w-6 h-6" />
            )}
          </button>
        </div>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="lg:hidden mt-4 pb-4 border-t border-border/50 pt-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex flex-col gap-2">
              {/* Mobile Solutions */}
              <div className="py-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 px-2">
                  {t.solutions}
                </div>
                {solutions.map((solution) => (
                  <Link
                    key={solution.name}
                    href={solution.href}
                    className="flex items-center gap-3 px-2 py-4 rounded-lg hover:bg-secondary transition-colors"
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <solution.icon className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground">{solution.name}</div>
                      <div className="text-xs text-muted-foreground line-clamp-2">{solution.description}</div>
                    </div>
                  </Link>
                ))}
              </div>

              <div className="border-t border-border/50 pt-2 mt-2">
                <Link
                  href="#features"
                  className="block px-2 py-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {t.about}
                </Link>
                <Link
                  href="#pricing"
                  className="block px-2 py-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {t.pricing}
                </Link>
                <Link
                  href="#contact"
                  className="block px-2 py-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {t.contact}
                </Link>
              </div>

              {/* Mobile Language Switcher */}
              <div className="border-t border-border/50 pt-4 mt-2">
                <div className="flex items-center gap-2 px-2 mb-3">
                  <Globe className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t.language}</span>
                </div>
                <div className="flex gap-2 px-2">
                  {languages.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => setLanguage(lang.code)}
                      className={`px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                        language === lang.code
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-foreground hover:bg-secondary/80"
                      }`}
                    >
                      {lang.code}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-3 pt-4 border-t border-border/50 mt-2 px-2">
                <Link href="/app" onClick={() => setIsMobileMenuOpen(false)}>
                  <Button variant="secondary" className="w-full justify-center text-sm font-medium py-6 bg-secondary hover:bg-secondary/80">
                    {t.cabinet}
                  </Button>
                </Link>
                <Button className="w-full text-sm font-medium py-6 bg-primary hover:bg-primary/90 text-primary-foreground">
                  {t.bookDemo}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
