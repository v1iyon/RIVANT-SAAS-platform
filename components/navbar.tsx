"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { User, X, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage, Language } from "@/lib/translations";
import { createClient } from "@/lib/supabase-browser";

interface NavbarProps {
  onOpenDemo?: () => void;
}

export function Navbar({ onOpenDemo }: NavbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const supabase = createClient();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { language, setLanguage, t } = useLanguage();
  const modalRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  // FIX: отдельный ref для кнопки-переключателя (гамбургер/X), чтобы
  // клик по ней не считался "кликом снаружи" меню и не вызывал повторное
  // открытие сразу после закрытия (race condition touchstart -> click).
  const menuToggleRef = useRef<HTMLButtonElement>(null);

  const T = t as any;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setIsLoggedIn(true);
    });
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        setIsLoginModalOpen(false);
      }
      // FIX: игнорируем клики по самой кнопке-переключателю,
      // иначе tap по X сначала закрывает меню через этот обработчик,
      // а следом идущий синтетический click открывает его обратно.
      const clickedToggle =
        menuToggleRef.current && menuToggleRef.current.contains(e.target as Node);
      if (
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(e.target as Node) &&
        !clickedToggle &&
        isMobileMenuOpen
      ) {
        setIsMobileMenuOpen(false);
      }
    };

    if (isLoginModalOpen || isMobileMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("touchstart", handleClickOutside);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.body.style.overflow = "";
    };
  }, [isLoginModalOpen, isMobileMenuOpen]);

  const scrollTo = (id: string) => {
    const element = document.querySelector(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
      setIsMobileMenuOpen(false);
    }
  };

  const changeLanguage = (lang: Language) => {
    console.log("Changing language to:", lang);
    setLanguage(lang);
  };

  const openLogin = () => {
    console.log("Opening login modal");
    setIsLoginModalOpen(true);
    setIsMobileMenuOpen(false);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);

    if (authMode === "signup") {
      const { error } = await supabase.auth.signUp({
        email: loginEmail,
        password: loginPassword,
      });
      setAuthLoading(false);
      if (error) {
        setAuthError(error.message);
        return;
      }
      try {
        const syncRes = await fetch("/api/auth-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: loginEmail, language }),
        });
        if (!syncRes.ok) {
          const errBody = await syncRes.json().catch(() => ({}));
          console.error("auth-sync failed:", syncRes.status, errBody);
          setAuthError(errBody.error || "Не удалось создать профиль. Попробуйте ещё раз.");
          setAuthLoading(false);
          return;
        }
      } catch (e) {
        console.error("auth-sync network error:", e);
        setAuthError("Ошибка сети при создании профиля. Проверьте соединение.");
        setAuthLoading(false);
        return;
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword,
      });
      setAuthLoading(false);
      if (error) {
        setAuthError(error.message);
        return;
      }
    }

    setIsLoggedIn(true);
    setIsLoginModalOpen(false);
    setLoginEmail("");
    setLoginPassword("");
    router.push("/dashboard");
  };

  const handleDemo = () => {
    if (onOpenDemo) {
      onOpenDemo();
    }
    setIsMobileMenuOpen(false);
  };

  const isDashboard = pathname === "/dashboard";
  if (isDashboard) return null;

  return (
    <>
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          isScrolled
            ? "bg-black/95 backdrop-blur-xl border-b border-white/10 py-2"
            : "bg-transparent py-3"
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="flex-shrink-0 cursor-pointer"
            >
              <img src="/icon8.png" alt="RIVANT" className="w-28 sm:w-40 md:w-52 object-contain" />
            </button>

            {!isDashboard && (
              <div className="hidden md:flex items-center gap-6">
                <button onClick={() => scrollTo("#features")} className="text-sm font-medium text-gray-400 hover:text-white">
                  {T.about || "About"}
                </button>
                <button onClick={() => scrollTo("#pricing")} className="text-sm font-medium text-gray-400 hover:text-white">
                  {T.pricing || "Pricing"}
                </button>
                <button onClick={() => scrollTo("#contact")} className="text-sm font-medium text-gray-400 hover:text-white">
                  {T.contact || "Contact"}
                </button>
              </div>
            )}

            <div className="hidden md:flex items-center gap-3">
              <div className="flex items-center bg-white/10 rounded-lg overflow-hidden">
                {(["EN", "UA", "DE"] as Language[]).map((lang) => (
                  <button
                    key={lang}
                    onClick={() => changeLanguage(lang)}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                      language === lang ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
                    }`}
                  >
                    {lang}
                  </button>
                ))}
              </div>

              {/* Demo button - полностью прозрачная, только обводка */}
              {!isDashboard && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-blue-600 text-blue-600 hover:bg-blue-600 hover:text-white cursor-pointer"
                  onClick={handleDemo}
                >
                  {T.demo || "Demo"}
                </Button>
              )}

              {/* Cabinet button - такой же стиль, но с полупрозрачным синим фоном */}
              {!isDashboard && (
                <Button
                  size="sm"
                  className="border border-blue-600 bg-blue-600/20 text-blue-600 hover:bg-blue-600 hover:text-white cursor-pointer"
                  onClick={openLogin}
                >
                  <User className="w-4 h-4 mr-1" /> {T.cabinet || "Cabinet"}
                </Button>
              )}
            </div>

            {!isDashboard && (
              // FIX: увеличенная тап-зона (p-3 -m-1 вместо p-2) — визуальный
              // размер иконки-гамбургера не меняется, но кликабельная область
              // становится примерно на 40% больше.
              <button
                ref={menuToggleRef}
                onClick={() => setIsMobileMenuOpen((prev) => !prev)}
                className="md:hidden flex flex-col gap-1.5 p-3 -m-1"
                aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
              >
                <span className={`w-6 h-0.5 bg-white transition-all ${isMobileMenuOpen ? "rotate-45 translate-y-2" : ""}`} />
                <span className={`w-6 h-0.5 bg-white transition-all ${isMobileMenuOpen ? "opacity-0" : ""}`} />
                <span className={`w-6 h-0.5 bg-white transition-all ${isMobileMenuOpen ? "-rotate-45 -translate-y-2" : ""}`} />
              </button>
            )}
          </div>
        </div>
      </nav>

      {!isDashboard && isMobileMenuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)} />
          <div
            ref={mobileMenuRef}
            className="absolute top-16 left-4 right-4 bg-gray-900 rounded-2xl border border-white/10 p-4 space-y-1"
          >
            <button
              onClick={() => scrollTo("#features")}
              className="w-full text-left px-4 py-2.5 text-gray-300 hover:text-white hover:bg-white/10 rounded-lg"
            >
              {T.about || "About"}
            </button>
            <button
              onClick={() => scrollTo("#pricing")}
              className="w-full text-left px-4 py-2.5 text-gray-300 hover:text-white hover:bg-white/10 rounded-lg"
            >
              {T.pricing || "Pricing"}
            </button>
            <button
              onClick={() => scrollTo("#contact")}
              className="w-full text-left px-4 py-2.5 text-gray-300 hover:text-white hover:bg-white/10 rounded-lg"
            >
              {T.contact || "Contact"}
            </button>

            <div className="border-t border-white/10 my-2" />

            <div className="px-4 py-2">
              <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                <Globe className="w-3 h-3" /> Language
              </p>
              <div className="flex gap-2">
                {(["EN", "UA", "DE"] as Language[]).map((lang) => (
                  <button
                    key={lang}
                    onClick={() => changeLanguage(lang)}
                    className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                      language === lang ? "bg-blue-600 text-white" : "bg-white/10 text-gray-400 hover:text-white"
                    }`}
                  >
                    {lang}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleDemo}
              className="w-full px-4 py-3 border border-blue-600 text-blue-600 rounded-lg font-medium hover:bg-blue-600 hover:text-white"
            >
              {T.demo || "Demo"}
            </button>

            <button
              onClick={openLogin}
              className="w-full px-4 py-3 border border-blue-600 bg-blue-600/20 text-blue-600 rounded-lg font-medium hover:bg-blue-600 hover:text-white"
            >
              <User className="w-4 h-4 inline mr-2" /> {T.cabinet || "Cabinet"}
            </button>
          </div>
        </div>
      )}

      {isLoginModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/90" onClick={() => setIsLoginModalOpen(false)} />
          <div
            ref={modalRef}
            className="relative w-full max-w-md bg-gray-900 rounded-2xl p-6 border border-white/10"
          >
            <button
              onClick={() => setIsLoginModalOpen(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white p-3 -m-1"
            >
              <X className="w-5 h-5" />
            </button>

            <h2 className="text-2xl font-bold text-white mb-2">
              {authMode === "signup" ? "Create Account" : "Welcome Back"}
            </h2>
            <p className="text-gray-400 text-sm mb-6">
              {authMode === "signup" ? "Start your 14-day free trial" : "Sign in to access your dashboard"}
            </p>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
                <input
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 text-white text-base"
                  placeholder="you@company.com"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Password</label>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 text-white text-base"
                  placeholder="••••••••"
                  minLength={6}
                  required
                />
              </div>
              {authError && <p className="text-red-400 text-sm">{authError}</p>}
              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {authLoading ? "..." : authMode === "signup" ? "Create Account" : "Sign In"}
              </button>
            </form>

            <p className="text-center text-sm text-gray-500 mt-4">
              {authMode === "signin" ? (
                <>Don't have an account?{" "}
                  <button onClick={() => { setAuthMode("signup"); setAuthError(""); }} className="text-blue-500 hover:underline">
                    Sign up
                  </button>
                </>
              ) : (
                <>Already have an account?{" "}
                  <button onClick={() => { setAuthMode("signin"); setAuthError(""); }} className="text-blue-500 hover:underline">
                    Sign in
                  </button>
                </>
              )}
            </p>

          </div>
        </div>
      )}
    </>
  );
}