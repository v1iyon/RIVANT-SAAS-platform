"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { User, X, Globe, Eye, EyeOff, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage, Language } from "@/lib/translations";
import { useCurrency, Currency } from "@/lib/currency";
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
  const [showPassword, setShowPassword] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaFactorId, setMfaFactorId] = useState("");
  // OTP-верификация email после signUp() — заменяет старый флоу "перейди по
  // ссылке в письме". otpEmail хранится отдельно от loginEmail, потому что
  // loginEmail очищается в конце успешного логина/регистрации, а нам нужен
  // email именно для verifyOtp()/resend() на этом отдельном шаге.
  const [otpStep, setOtpStep] = useState(false);
  const [otpEmail, setOtpEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpResendCooldown, setOtpResendCooldown] = useState(0);
  const [otpResendMessage, setOtpResendMessage] = useState("");
  // "Забули пароль?" — з'являється під формою входу ПІСЛЯ невдалої спроби
  // з невірним паролем (не одразу, щоб не захаращувати форму для тих, хто
  // просто вперше бачить логін). isForgotPassword перемикає саму модалку
  // на окремий міні-флоу (email -> supabase.auth.resetPasswordForEmail),
  // не чіпаючи authMode — щоб "Назад" повертав рівно туди, звідки прийшли
  // (signin або signup).
  const [showForgotHint, setShowForgotHint] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const supabase = createClient();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { language, setLanguage, t } = useLanguage();
  const { currency, setCurrency } = useCurrency();
  const modalRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  // FIX: отдельный ref для кнопки-переключателя (гамбургер/X), чтобы
  // клик по ней не считался "кликом снаружи" меню и не вызывал повторное
  // открытие сразу после закрытия (race condition touchstart -> click).
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  // Компактные выпадающие меню язык / валюта рядом с гамбургером на мобилке —
  // два отдельных дропдауна (каждый со своим триггером), чтобы сменить язык
  // или валюту можно было в один тап, не открывая весь список ссылок и не
  // путая пользователя одним общим меню "два в одном".
  const [isLangOpen, setIsLangOpen] = useState(false);
  const [isCurrencyOpen, setIsCurrencyOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);
  const langToggleRef = useRef<HTMLButtonElement>(null);
  const currencyRef = useRef<HTMLDivElement>(null);
  const currencyToggleRef = useRef<HTMLButtonElement>(null);

  const T = t as any;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setIsLoggedIn(true);
        // FIX: подстраховка — если у человека есть активная сессия, значит
        // аккаунт точно существует. Фиксируем это в localStorage на случай,
        // если флаг ещё не был проставлен раньше (например, старая сессия,
        // созданная до этого фикса).
        localStorage.setItem("rivant_has_account", "1");
      }
    });
  }, []);

  // NEW: слушатель на смену auth-состояния — нужен специально для Google-входа.
  // Google-логин делает полный редирект (сайт -> google.com -> обратно на
  // redirectTo), поэтому обычный код после signInWithOAuth() в
  // handleGoogleSignIn никогда не выполняется (компонент к этому моменту уже
  // размонтирован/страница перезагружена). onAuthStateChange — единственный
  // надёжный способ поймать момент "человек только что вошёл через Google" и
  // на этот момент дозаписать профиль через /api/auth-sync, как это делается
  // для обычной регистрации email+паролем.
  //
  // ВАЖНО: Navbar не рендерится на /dashboard (см. `if (isDashboard) return
  // null` ниже), НО хуки всё равно выполняются на каждом рендере компонента
  // независимо от того, что возвращает JSX — поэтому этот слушатель будет
  // работать и тогда, когда человек уже физически на /dashboard.
  //
  // Предполагается, что /api/auth-sync идемпотентен (безопасно вызывать
  // повторно для уже существующего пользователя — например, делает upsert,
  // а не insert). Если это не так и повторный вызов на каждый вход через
  // Google создаёт дубликаты — нужно поправить сам /api/auth-sync, а не эту
  // логику.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event !== "SIGNED_IN" || !session) return;

      const provider = session.user?.app_metadata?.provider;
      if (provider !== "google") return;

      try {
        const syncRes = await fetch("/api/auth-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: session.user.email,
            language,
          }),
        });
        if (!syncRes.ok) {
          console.error("auth-sync failed after Google sign-in:", syncRes.status);
        }
      } catch (e) {
        console.error("auth-sync network error after Google sign-in:", e);
      }

      localStorage.setItem("rivant_has_account", "1");
      setIsLoggedIn(true);
    });

    return () => {
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Обратный отсчёт для кнопки "Отправить код ещё раз" на OTP-шаге —
  // обычный setInterval, тикает раз в секунду, пока otpResendCooldown > 0.
  useEffect(() => {
    if (otpResendCooldown <= 0) return;
    const id = setInterval(() => {
      setOtpResendCooldown((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [otpResendCooldown]);

  // Позволяет другим компонентам (например, кнопкам тарифов в
  // pricing-section) открыть модалку регистрации, не поднимая стейт
  // модалки на уровень страницы: window.dispatchEvent(new CustomEvent("rivant:open-signup"))
  useEffect(() => {
    const handleOpenSignup = () => {
      // FIX: раньше здесь всегда стоял authMode "signup" — даже если человек
      // уже регистрировался в этом браузере раньше. Теперь смотрим на флаг
      // rivant_has_account (ставится ниже при успешном входе/регистрации) и
      // открываем модалку сразу на вкладке "Увійти", если аккаунт уже был.
      // Вкладка регистрации по-прежнему доступна одним кликом внизу модалки.
      const hasAccount =
        typeof window !== "undefined" && localStorage.getItem("rivant_has_account") === "1";
      setAuthMode(hasAccount ? "signin" : "signup");
      setAuthError("");
      setShowForgotHint(false);
      setIsForgotPassword(false);
      setOtpStep(false);
      setIsLoginModalOpen(true);
      setIsMobileMenuOpen(false);
    };
    window.addEventListener("rivant:open-signup", handleOpenSignup);
    return () => window.removeEventListener("rivant:open-signup", handleOpenSignup);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        closeLoginModal();
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

      const clickedLangToggle =
        langToggleRef.current && langToggleRef.current.contains(e.target as Node);
      if (
        langRef.current &&
        !langRef.current.contains(e.target as Node) &&
        !clickedLangToggle &&
        isLangOpen
      ) {
        setIsLangOpen(false);
      }

      const clickedCurrencyToggle =
        currencyToggleRef.current && currencyToggleRef.current.contains(e.target as Node);
      if (
        currencyRef.current &&
        !currencyRef.current.contains(e.target as Node) &&
        !clickedCurrencyToggle &&
        isCurrencyOpen
      ) {
        setIsCurrencyOpen(false);
      }
    };

    if (isLoginModalOpen || isMobileMenuOpen || isLangOpen || isCurrencyOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("touchstart", handleClickOutside);
      if (isLoginModalOpen || isMobileMenuOpen) document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.body.style.overflow = "";
    };
  }, [isLoginModalOpen, isMobileMenuOpen, isLangOpen, isCurrencyOpen]);

  const scrollTo = (id: string) => {
    const element = document.querySelector(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
      setIsMobileMenuOpen(false);
    }
  };

  const changeLanguage = (lang: Language) => {
    setLanguage(lang);
  };

  const changeCurrency = (cur: Currency) => {
    setCurrency(cur);
  };

  const openLogin = () => {
    setShowForgotHint(false);
    setIsForgotPassword(false);
    setOtpStep(false);
    setIsLoginModalOpen(true);
    setIsMobileMenuOpen(false);
  };

  // Закрытие модалки крестиком/кликом по фону — сбрасываем otpStep, чтобы
  // при повторном открытии модалки (например, через "Cabinet" в шапке)
  // человек не увидел зависший экран ввода кода от прошлой попытки
  // регистрации вместо обычной формы входа.
  const closeLoginModal = () => {
    setIsLoginModalOpen(false);
    setOtpStep(false);
  };

  // FIX (аудит п.5): раньше кнопка "Cabinet" всегда открывала модалку логина,
  // даже если пользователь уже вошёл (isLoggedIn выставлялся, но нигде не
  // читался). Теперь залогиненный сразу попадает в /dashboard, без лишнего
  // шага с формой входа.
  const handleCabinetClick = () => {
    if (isLoggedIn) {
      setIsMobileMenuOpen(false);
      router.push("/dashboard");
    } else {
      openLogin();
    }
  };

  // Supabase (и просто network errors типа "Failed to fetch") отдают текст
  // ошибки на английском независимо от языка сайта — раньше это летело в UI
  // как есть. Мапим самые частые случаи на текст на текущем языке интерфейса,
  // а для непредвиденных ошибок — честный дженерик текст, а не сырой английский.
  const translateAuthError = (rawMessage: string): string => {
    const msg = (rawMessage || "").toLowerCase();
    const dict: Record<string, Record<Language, string>> = {
      network: {
        EN: "Network error. Please check your connection and try again.",
        UA: "Помилка мережі. Перевірте з'єднання і спробуйте ще раз.",
        DE: "Netzwerkfehler. Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut.",
      },
      invalidCredentials: {
        EN: "Incorrect email or password.",
        UA: "Невірна пошта або пароль.",
        DE: "Falsche E-Mail oder falsches Passwort.",
      },
      emailNotConfirmed: {
        EN: "Please confirm your email before signing in.",
        UA: "Підтвердіть пошту перед входом.",
        DE: "Bitte bestätigen Sie Ihre E-Mail, bevor Sie sich anmelden.",
      },
      alreadyRegistered: {
        EN: "This email is already registered. Try signing in instead.",
        UA: "Ця пошта вже зареєстрована. Спробуйте увійти.",
        DE: "Diese E-Mail ist bereits registriert. Bitte melden Sie sich stattdessen an.",
      },
      passwordTooShort: {
        EN: "Password must be at least 6 characters.",
        UA: "Пароль має містити щонайменше 6 символів.",
        DE: "Das Passwort muss mindestens 6 Zeichen lang sein.",
      },
      generic: {
        EN: "Something went wrong. Please try again.",
        UA: "Щось пішло не так. Спробуйте ще раз.",
        DE: "Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.",
      },
    };
    let key: keyof typeof dict = "generic";
    if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("load failed")) key = "network";
    else if (msg.includes("invalid login credentials") || msg.includes("invalid email or password")) key = "invalidCredentials";
    else if (msg.includes("email not confirmed")) key = "emailNotConfirmed";
    else if (msg.includes("already registered") || msg.includes("already exists") || msg.includes("user already")) key = "alreadyRegistered";
    else if (msg.includes("password") && (msg.includes("short") || msg.includes("6 char") || msg.includes("at least"))) key = "passwordTooShort";
    return dict[key][language] || dict[key].EN;
  };

  // Той самий патерн визначення "невірний пароль/email", що вже
  // використовується всередині translateAuthError вище — винесено окремо,
  // бо тут потрібен саме булевий прапорець (показати лінк "Забули пароль?"),
  // а не текст помилки.
  const isInvalidCredentialsError = (rawMessage: string): boolean => {
    const msg = (rawMessage || "").toLowerCase();
    return msg.includes("invalid login credentials") || msg.includes("invalid email or password");
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError("");
    setForgotLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setForgotLoading(false);
    if (error) {
      // Свідомо не розрізняємо "такого email немає" від інших помилок —
      // інакше форма скидання пароля перетворюється на спосіб перевірити,
      // чи зареєстрований конкретний email (user enumeration).
      setForgotError(translateAuthError(error.message));
      return;
    }
    setForgotSent(true);
  };

  const openForgotPassword = () => {
    setForgotEmail(loginEmail);
    setForgotError("");
    setForgotSent(false);
    setIsForgotPassword(true);
  };

  const backFromForgotPassword = () => {
    setIsForgotPassword(false);
    setForgotError("");
    setForgotSent(false);
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
        setAuthError(translateAuthError(error.message));
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
          setAuthError(
            errBody.error ||
              (language === "UA"
                ? "Не вдалося створити профіль. Спробуйте ще раз."
                : language === "DE"
                ? "Profil konnte nicht erstellt werden. Bitte versuchen Sie es erneut."
                : "Could not create profile. Please try again.")
          );
          setAuthLoading(false);
          return;
        }
      } catch (e) {
        console.error("auth-sync network error:", e);
        setAuthError(translateAuthError("failed to fetch"));
        setAuthLoading(false);
        return;
      }

      // FIX (OTP-верификация): раньше отсюда падали в общий хвост функции
      // (setIsLoggedIn(true) + router.push("/dashboard")) сразу после
      // signUp(), хотя подтверждение email в проекте включено — сессии на
      // этот момент ЕЩЁ НЕТ (supabase.auth.signUp() без подтверждения не
      // возвращает session), человека просто кидало на /dashboard без
      // реального входа. Теперь вместо этого показываем экран ввода
      // 6-значного кода из письма (см. handleVerifySignupOtp ниже) — сессия
      // появляется только после успешного verifyOtp().
      setOtpEmail(loginEmail);
      setOtpCode("");
      setOtpResendMessage("");
      setOtpResendCooldown(30);
      setOtpStep(true);
      setAuthLoading(false);
      return;
   } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword,
      });
      setAuthLoading(false);
      if (error) {
        setAuthError(translateAuthError(error.message));
        // "Забули пароль?" з'являється саме тут — після реальної невдалої
        // спроби входу з невірними даними, а не за замовчуванням на формі.
        setShowForgotHint(isInvalidCredentialsError(error.message));
        return;
      }
      setShowForgotHint(false);

      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel) {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const factor = factors?.totp?.[0];
        if (factor) {
          setMfaFactorId(factor.id);
          setMfaStep(true);
          return;
        }
      }
    }

    // FIX: аккаунт точно существует (только что зарегистрировали или вошли) —
    // фиксируем это в localStorage, чтобы rivant:open-signup в следующий раз
    // открывал модалку сразу на "Увійти", а не "Зареєструватися".
    localStorage.setItem("rivant_has_account", "1");
    setIsLoggedIn(true);
    setIsLoginModalOpen(false);
    setLoginEmail("");
    setLoginPassword("");
    router.push("/dashboard");
  };

  // Подтверждение 6-значного кода из письма после signUp(). type: "signup" —
  // Supabase различает OTP разных типов (signup / recovery / email_change и
  // т.д.), присланный код валиден только для того типа, для которого его
  // сгенерировали.
  const handleVerifySignupOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);

    const { data, error } = await supabase.auth.verifyOtp({
      email: otpEmail,
      token: otpCode,
      type: "signup",
    });

    setAuthLoading(false);

    if (error || !data.session) {
      setAuthError(T.otpInvalidCode ?? translateAuthError(error?.message || "invalid code"));
      return;
    }

    // Тот же самый хвост, что и в handleLogin — теперь у нас есть реальная
    // сессия (data.session), так что переход в /dashboard корректен.
    localStorage.setItem("rivant_has_account", "1");
    setIsLoggedIn(true);
    setOtpStep(false);
    setOtpCode("");
    setOtpEmail("");
    setIsLoginModalOpen(false);
    setLoginEmail("");
    setLoginPassword("");
    router.push("/dashboard");
  };

  // "Отправить код ещё раз" — resend() с тем же типом "signup" генерирует
  // новый OTP и шлёт новое письмо; старый код при этом становится
  // недействительным на стороне Supabase. Клиентский cooldown (30с) — просто
  // защита от случайного даблклика, не rate-limit сам по себе (это делает
  // сам Supabase на своей стороне).
  const handleResendSignupOtp = async () => {
    if (otpResendCooldown > 0) return;
    setAuthError("");
    setOtpResendMessage("");
    setAuthLoading(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: otpEmail,
    });
    setAuthLoading(false);
    if (error) {
      setAuthError(translateAuthError(error.message));
      return;
    }
    setOtpResendMessage(T.otpResendSuccess ?? "New code sent.");
    setOtpResendCooldown(30);
  };

  // "Использовать другой email" — возврат с OTP-шага на форму регистрации,
  // не теряя выбранный язык/режим формы.
  const handleBackFromOtp = () => {
    setOtpStep(false);
    setOtpCode("");
    setAuthError("");
    setOtpResendMessage("");
  };

  // NEW: вход через Google. signInWithOAuth() делает редирект браузера на
  // google.com — код после него в этой функции обычно не успевает
  // выполниться (кроме случая ошибки ДО редиректа, например неверно
  // настроенный provider). Основная логика "что делать после успешного
  // входа" — в слушателе onAuthStateChange выше.
  const handleGoogleSignIn = async () => {
    setAuthError("");
    setAuthLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
      },
    });
    if (error) {
      setAuthLoading(false);
      setAuthError(translateAuthError(error.message));
    }
  };

  const handleVerifyMfa = async () => {
    setAuthLoading(true);
    setAuthError("");
    const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({ factorId: mfaFactorId });
    if (chErr) {
      setAuthLoading(false);
      setAuthError(translateAuthError(chErr.message));
      return;
    }
    const { error: verErr } = await supabase.auth.mfa.verify({
      factorId: mfaFactorId,
      challengeId: challenge.id,
      code: mfaCode,
    });
    setAuthLoading(false);
    if (verErr) {
      setAuthError(translateAuthError(verErr.message));
      return;
    }
    // FIX: тот же флаг, что и в handleLogin выше — этот путь используется
    // теми, у кого включена 2FA, поэтому обычный хвост handleLogin до него
    // не доходит и localStorage.setItem нужно продублировать здесь.
    localStorage.setItem("rivant_has_account", "1");
    setIsLoggedIn(true);
    setIsLoginModalOpen(false);
    setMfaStep(false);
    setMfaCode("");
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

              <div className="flex items-center bg-white/10 rounded-lg overflow-hidden">
                {(["USD", "EUR"] as Currency[]).map((cur) => (
                  <button
                    key={cur}
                    onClick={() => changeCurrency(cur)}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                      currency === cur ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
                    }`}
                  >
                    {cur === "USD" ? "$" : "€"}
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
                  onClick={handleCabinetClick}
                >
                  <User className="w-4 h-4 mr-1" /> {T.cabinet || "Cabinet"}
                </Button>
              )}
            </div>

            {!isDashboard && (
              <div className="flex items-center gap-1 md:hidden">
                {/* Два независимых компактных переключателя — язык и валюта —
                    отдельно от гамбургера и друг от друга, чтобы каждый
                    открывался и закрывался сам по себе, без единого меню
                    "два в одном". */}
                <div className="relative">
                  <button
                    ref={langToggleRef}
                    onClick={() => {
                      setIsLangOpen((prev) => !prev);
                      setIsCurrencyOpen(false);
                      setIsMobileMenuOpen(false);
                    }}
                    className="flex items-center gap-1 px-2 py-2 -m-1 text-gray-300 hover:text-white"
                    aria-label="Language"
                  >
                    <Globe className="w-5 h-5" />
                    <span className="text-xs font-medium">{language}</span>
                    <ChevronDown className={`w-3 h-3 transition-transform ${isLangOpen ? "rotate-180" : ""}`} />
                  </button>

                  {isLangOpen && (
                    <div
                      ref={langRef}
                      className="absolute top-full right-0 mt-2 w-24 bg-gray-900 rounded-xl border border-white/10 p-2 z-50 shadow-xl"
                    >
                      <p className="text-xs text-gray-500 mb-1.5 px-1">{T.language || "Language"}</p>
                      <div className="flex flex-col gap-1">
                        {(["EN", "UA", "DE"] as Language[]).map((lang) => (
                          <button
                            key={lang}
                            onClick={() => {
                              changeLanguage(lang);
                              setIsLangOpen(false);
                            }}
                            className={`w-full py-1.5 text-xs font-medium rounded-lg transition-colors ${
                              language === lang ? "bg-blue-600 text-white" : "bg-white/10 text-gray-400 hover:text-white"
                            }`}
                          >
                            {lang}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="relative">
                  <button
                    ref={currencyToggleRef}
                    onClick={() => {
                      setIsCurrencyOpen((prev) => !prev);
                      setIsLangOpen(false);
                      setIsMobileMenuOpen(false);
                    }}
                    className="flex items-center gap-1 px-2 py-2 -m-1 text-gray-300 hover:text-white"
                    aria-label="Currency"
                  >
                    <span className="w-5 h-5 flex items-center justify-center text-base font-semibold leading-none">{currency === "USD" ? "$" : "€"}</span>
                    <ChevronDown className={`w-3 h-3 transition-transform ${isCurrencyOpen ? "rotate-180" : ""}`} />
                  </button>

                  {isCurrencyOpen && (
                    <div
                      ref={currencyRef}
                      className="absolute top-full right-0 mt-2 w-24 bg-gray-900 rounded-xl border border-white/10 p-2 z-50 shadow-xl"
                    >
                      <p className="text-xs text-gray-500 mb-1.5 px-1">{T.currency || "Currency"}</p>
                      <div className="flex flex-col gap-1">
                        {(["USD", "EUR"] as Currency[]).map((cur) => (
                          <button
                            key={cur}
                            onClick={() => {
                              changeCurrency(cur);
                              setIsCurrencyOpen(false);
                            }}
                            className={`w-full py-1.5 text-xs font-medium rounded-lg transition-colors ${
                              currency === cur ? "bg-blue-600 text-white" : "bg-white/10 text-gray-400 hover:text-white"
                            }`}
                          >
                            {cur === "USD" ? "$ USD" : "€ EUR"}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* FIX: увеличенная тап-зона (p-3 -m-1 вместо p-2) — визуальный
                    размер иконки-гамбургера не меняется, но кликабельная область
                    становится примерно на 40% больше. */}
                <button
                  ref={menuToggleRef}
                  onClick={() => {
                    setIsMobileMenuOpen((prev) => !prev);
                    setIsLangOpen(false);
                    setIsCurrencyOpen(false);
                  }}
                  className="flex flex-col gap-1.5 p-3 -m-1"
                  aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
                >
                  <span className={`w-6 h-0.5 bg-white transition-all ${isMobileMenuOpen ? "rotate-45 translate-y-2" : ""}`} />
                  <span className={`w-6 h-0.5 bg-white transition-all ${isMobileMenuOpen ? "opacity-0" : ""}`} />
                  <span className={`w-6 h-0.5 bg-white transition-all ${isMobileMenuOpen ? "-rotate-45 -translate-y-2" : ""}`} />
                </button>
              </div>
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

            <button
              onClick={handleDemo}
              className="w-full px-4 py-3 border border-blue-600 text-blue-600 rounded-lg font-medium hover:bg-blue-600 hover:text-white"
            >
              {T.demo || "Demo"}
            </button>

            <button
              onClick={handleCabinetClick}
              className="w-full px-4 py-3 border border-blue-600 bg-blue-600/20 text-blue-600 rounded-lg font-medium hover:bg-blue-600 hover:text-white"
            >
              <User className="w-4 h-4 inline mr-2" /> {T.cabinet || "Cabinet"}
            </button>
          </div>
        </div>
      )}

      {isLoginModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/90" onClick={closeLoginModal} />
          <div
            ref={modalRef}
            className="relative w-full max-w-md bg-gray-900 rounded-2xl p-6 border border-white/10"
          >
            <button
              onClick={closeLoginModal}
              className="absolute top-4 right-4 text-gray-400 hover:text-white p-3 -m-1"
            >
              <X className="w-5 h-5" />
            </button>

           {isForgotPassword ? (
              <>
                <h2 className="text-2xl font-bold text-white mb-2">
                  {language === "UA" ? "Відновлення пароля" : language === "DE" ? "Passwort zurücksetzen" : "Reset your password"}
                </h2>
                {forgotSent ? (
                  <>
                    <p className="text-gray-400 text-sm mb-6">
                      {language === "UA"
                        ? <>Якщо акаунт з адресою <span className="text-gray-300 font-medium">{forgotEmail}</span> існує, ми надіслали на неї лист із посиланням для скидання пароля. Перевірте також папку "Спам".</>
                        : language === "DE"
                        ? <>Falls ein Konto mit der Adresse <span className="text-gray-300 font-medium">{forgotEmail}</span> existiert, haben wir eine E-Mail mit einem Link zum Zurücksetzen des Passworts gesendet. Prüfen Sie auch Ihren Spam-Ordner.</>
                        : <>If an account with <span className="text-gray-300 font-medium">{forgotEmail}</span> exists, we've sent a password reset link to it. Check your spam folder too.</>}
                    </p>
                    <button
                      onClick={backFromForgotPassword}
                      className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
                    >
                      {language === "UA" ? "Назад до входу" : language === "DE" ? "Zurück zur Anmeldung" : "Back to sign in"}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-gray-400 text-sm mb-6">
                      {language === "UA"
                        ? "Введіть email, з яким ви реєструвались — надішлемо посилання для скидання пароля."
                        : language === "DE"
                        ? "Geben Sie Ihre E-Mail-Adresse ein — wir senden Ihnen einen Link zum Zurücksetzen des Passworts."
                        : "Enter the email you signed up with — we'll send you a password reset link."}
                    </p>
                    <form onSubmit={handleForgotPassword} className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">{t.emailLabel}</label>
                        <input
                          type="email"
                          value={forgotEmail}
                          onChange={(e) => setForgotEmail(e.target.value)}
                          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 text-white text-base"
                          placeholder="you@company.com"
                          required
                          autoFocus
                        />
                      </div>
                      {forgotError && <p className="text-red-400 text-sm">{forgotError}</p>}
                      <button
                        type="submit"
                        disabled={forgotLoading}
                        className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
                      >
                        {forgotLoading ? "..." : language === "UA" ? "Надіслати посилання" : language === "DE" ? "Link senden" : "Send reset link"}
                      </button>
                    </form>
                    <button
                      onClick={backFromForgotPassword}
                      className="w-full text-center text-sm text-gray-500 hover:text-gray-300 mt-4"
                    >
                      {language === "UA" ? "← Назад до входу" : language === "DE" ? "← Zurück zur Anmeldung" : "← Back to sign in"}
                    </button>
                  </>
                )}
              </>
            ) : otpStep ? (
              <>
                <h2 className="text-2xl font-bold text-white mb-2">
                  {T.otpTitle ?? "Check your email"}
                </h2>
                <p className="text-gray-400 text-sm mb-6">
                  {T.otpSubtitle ?? "We've sent a 6-digit code to"}{" "}
                  <span className="text-gray-300 font-medium">{otpEmail}</span>
                </p>
                <form onSubmit={handleVerifySignupOtp} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      {T.otpCodeLabel ?? "Verification code"}
                    </label>
                    <input
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white text-lg text-center tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-blue-600"
                      placeholder={T.otpCodePlaceholder ?? "123456"}
                      autoFocus
                      required
                    />
                  </div>
                  {authError && <p className="text-red-400 text-sm">{authError}</p>}
                  {!authError && otpResendMessage && (
                    <p className="text-green-400 text-sm">{otpResendMessage}</p>
                  )}
                  <button
                    type="submit"
                    disabled={authLoading || otpCode.length !== 6}
                    className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {authLoading ? "..." : T.otpVerifyBtn ?? "Verify"}
                  </button>
                </form>
                <button
                  type="button"
                  onClick={handleResendSignupOtp}
                  disabled={authLoading || otpResendCooldown > 0}
                  className="w-full text-center text-sm text-gray-400 hover:text-gray-200 mt-4 disabled:opacity-50 disabled:hover:text-gray-400"
                >
                  {otpResendCooldown > 0
                    ? (T.otpResendCooldown ?? "Resend in {seconds}s").replace(
                        "{seconds}",
                        String(otpResendCooldown)
                      )
                    : T.otpResendBtn ?? "Resend code"}
                </button>
                <button
                  type="button"
                  onClick={handleBackFromOtp}
                  className="w-full text-center text-sm text-gray-500 hover:text-gray-300 mt-2"
                >
                  ← {T.otpChangeEmail ?? "Use a different email"}
                </button>
              </>
            ) : mfaStep ? (
              <>
                <h2 className="text-2xl font-bold text-white mb-2">
                  {language === "UA" ? "Введіть код 2FA" : language === "DE" ? "2FA-Code eingeben" : "Enter 2FA code"}
                </h2>
                <p className="text-gray-400 text-sm mb-6">
                  {language === "UA" ? "Відкрийте застосунок-автентифікатор" : language === "DE" ? "Öffnen Sie Ihre Authenticator-App" : "Open your authenticator app"}
                </p>
                <input
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  maxLength={6}
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white text-base text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-600"
                  placeholder="000000"
                />
                {authError && <p className="text-red-400 text-sm mt-2">{authError}</p>}
                <button
                  onClick={handleVerifyMfa}
                  disabled={authLoading}
                  className="w-full mt-4 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {authLoading ? "..." : language === "UA" ? "Підтвердити" : language === "DE" ? "Bestätigen" : "Verify"}
                </button>
              </>
            ) : (
            <>
            <h2 className="text-2xl font-bold text-white mb-2">
  {authMode === "signup" ? t.registerTitle : t.loginTitle}
</h2>
<p className="text-gray-400 text-sm mb-6">
  {authMode === "signup" ? t.registerSubtitle : t.loginSubtitle}
</p>

<button
  type="button"
  onClick={handleGoogleSignIn}
  disabled={authLoading}
  className="w-full flex items-center justify-center gap-3 py-3 mb-4 bg-white text-gray-800 rounded-lg font-medium hover:bg-gray-100 disabled:opacity-50 border border-gray-300"
>
  <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>
    <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.69 9c0-.6.1-1.18.28-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"/>
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
  </svg>
  {language === "UA" ? "Увійти через Google" : language === "DE" ? "Mit Google anmelden" : "Continue with Google"}
</button>

<div className="flex items-center gap-3 mb-4">
  <div className="flex-1 h-px bg-gray-700" />
  <span className="text-xs text-gray-500">
    {language === "UA" ? "або" : language === "DE" ? "oder" : "or"}
  </span>
  <div className="flex-1 h-px bg-gray-700" />
</div>

            <form onSubmit={handleLogin} className="space-y-4">
  <div>
    <label className="block text-sm font-medium text-gray-300 mb-1">
      {t.emailLabel}
    </label>
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
    <label className="block text-sm font-medium text-gray-300 mb-1">
      {t.passwordLabel}
    </label>
    <div className="relative">
      <input
        type={showPassword ? "text" : "password"}
        value={loginPassword}
        onChange={(e) => setLoginPassword(e.target.value)}
        className="w-full px-4 py-3 pr-11 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 text-white text-base"
        placeholder="••••••••"
        minLength={6}
        required
      />
      <button
        type="button"
        onClick={() => setShowPassword((v) => !v)}
        tabIndex={-1}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
        aria-label={showPassword ? "Hide password" : "Show password"}
      >
        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  </div>
  {authError && (
    <div>
      <p className="text-red-400 text-sm">{authError}</p>
      {authMode === "signin" && showForgotHint && (
        <button
          type="button"
          onClick={openForgotPassword}
          className="text-sm text-blue-500 hover:underline mt-1"
        >
          {language === "UA" ? "Забули пароль?" : language === "DE" ? "Passwort vergessen?" : "Forgot password?"}
        </button>
      )}
    </div>
  )}
  <button
    type="submit"
    disabled={authLoading}
    className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
  >
    {authLoading ? "..." : authMode === "signup" ? t.signUpBtn : t.signInBtn}
  </button>
</form>

<p className="text-center text-sm text-gray-500 mt-4">
  {authMode === "signin" ? (
    <>
      {t.noAccountText}{" "}
      <button 
        onClick={() => { setAuthMode("signup"); setAuthError(""); setShowForgotHint(false); }} 
        className="text-blue-500 hover:underline"
      >
        {t.signUpLink}
      </button>
    </>
  ) : (
    <>
      {t.hasAccountText}{" "}
      <button 
        onClick={() => { setAuthMode("signin"); setAuthError(""); setShowForgotHint(false); }} 
        className="text-blue-500 hover:underline"
      >
        {t.signInLink}
      </button>
    </>
  )}
</p>
            </>
            )}

          </div>
        </div>
      )}
    </>
  );
}