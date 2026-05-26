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

const languages = [
  { code: "EN", label: "English" },
  { code: "UA", label: "Українська" },
  { code: "DE", label: "Deutsch" },
];

const solutions = [
  {
    icon: ShoppingCart,
    name: "E-commerce",
    description: "Track hidden fees, refund leaks, and ad spend inefficiencies across your online store.",
    href: "#calculator",
  },
  {
    icon: Truck,
    name: "Logistics",
    description: "Monitor fuel costs, route inefficiencies, and delivery delays eating into margins.",
    href: "#calculator",
  },
  {
    icon: UtensilsCrossed,
    name: "Hospitality",
    description: "Detect food waste, labor overruns, and booking channel fees in restaurants and hotels.",
    href: "#calculator",
  },
];

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [currentLang, setCurrentLang] = useState("EN");

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
          ? "glass py-3"
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
              <DropdownMenuTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
                Solutions <ChevronDown className="w-4 h-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="glass-strong border-border/50 w-80 p-2">
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
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              About
            </Link>

            <Link
              href="#pricing"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Pricing
            </Link>

            <Link
              href="#contact"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Contact
            </Link>
          </div>

          {/* Desktop CTA Buttons */}
          <div className="hidden lg:flex items-center gap-3">
            {/* Language Switcher */}
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-md hover:bg-white/5">
                <Globe className="w-4 h-4" />
                {currentLang}
                <ChevronDown className="w-3 h-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="glass-strong border-border/50">
                {languages.map((lang) => (
                  <DropdownMenuItem 
                    key={lang.code}
                    onClick={() => setCurrentLang(lang.code)}
                    className={`focus:bg-primary/10 cursor-pointer ${
                      currentLang === lang.code ? "text-primary" : ""
                    }`}
                  >
                    {lang.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Link href="/app">
              <Button variant="ghost" className="text-sm">
                Cabinet
              </Button>
            </Link>
            <Button className="text-sm bg-primary hover:bg-primary/90">
              Book Demo
            </Button>
          </div>

          {/* Mobile Menu Button */}
          <button
            className="lg:hidden text-foreground p-2"
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
                  Solutions
                </div>
                {solutions.map((solution) => (
                  <Link
                    key={solution.name}
                    href={solution.href}
                    className="flex items-center gap-3 px-2 py-3 rounded-lg hover:bg-white/5 transition-colors"
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <solution.icon className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground">{solution.name}</div>
                      <div className="text-xs text-muted-foreground">{solution.description}</div>
                    </div>
                  </Link>
                ))}
              </div>

              <div className="border-t border-border/50 pt-2 mt-2">
                <Link
                  href="#features"
                  className="block px-2 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  About
                </Link>
                <Link
                  href="#pricing"
                  className="block px-2 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Pricing
                </Link>
                <Link
                  href="#contact"
                  className="block px-2 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Contact
                </Link>
              </div>

              {/* Mobile Language Switcher */}
              <div className="border-t border-border/50 pt-4 mt-2">
                <div className="flex items-center gap-2 px-2 mb-3">
                  <Globe className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Language</span>
                </div>
                <div className="flex gap-2 px-2">
                  {languages.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => setCurrentLang(lang.code)}
                      className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                        currentLang === lang.code
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                      }`}
                    >
                      {lang.code}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-4 border-t border-border/50 mt-2">
                <Link href="/app" onClick={() => setIsMobileMenuOpen(false)}>
                  <Button variant="ghost" className="w-full justify-center text-sm">
                    Cabinet
                  </Button>
                </Link>
                <Button className="w-full text-sm bg-primary hover:bg-primary/90">
                  Book Demo
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
