"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, CheckCircle, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase-browser";
import { useLanguage } from "@/lib/translations";
import { translateUnknownError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";

// Сторінка, на яку Supabase редіректить після кліку по посиланню з листа
// "Забули пароль?" (див. components/navbar.tsx -> handleForgotPassword,
// resetPasswordForEmail({ redirectTo: ".../reset-password" })).
//
// Клієнт Supabase (@supabase/ssr, detectSessionInUrl: true за замовчуванням)
// сам розбирає токен/код з URL і встановлює тимчасову сесію відновлення,
// після чого стріляє подія "PASSWORD_RECOVERY" через onAuthStateChange —
// лише після неї supabase.auth.updateUser({ password }) реально спрацює.
export default function ResetPasswordPage() {
  const router = useRouter();
  const { language } = useLanguage();
  const supabase = createClient();

  const [checkingLink, setCheckingLink] = useState(true);
  const [linkValid, setLinkValid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setLinkValid(true);
        setCheckingLink(false);
      }
    });

    // Фолбек: якщо подія PASSWORD_RECOVERY встигла спрацювати ще до того,
    // як цей listener підключився (рідко, але можливо на дуже швидких
    // з'єднаннях), сесія вже буде — перевіряємо її напряму.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setLinkValid(true);
      setCheckingLink(false);
    });

    // Якщо за 5 секунд так нічого й не встановилось — вважаємо посилання
    // недійсним/протермінованим, а не тримаємо людину на спінері вічно.
    const timeout = setTimeout(() => setCheckingLink(false), 5000);

    return () => {
      listener.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const passwordLabel =
    language === "UA" ? "Новий пароль" : language === "DE" ? "Neues Passwort" : "New password";
  const confirmLabel =
    language === "UA" ? "Підтвердіть пароль" : language === "DE" ? "Passwort bestätigen" : "Confirm password";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError(
        language === "UA"
          ? "Пароль має містити щонайменше 6 символів"
          : language === "DE"
          ? "Das Passwort muss mindestens 6 Zeichen lang sein"
          : "Password must be at least 6 characters"
      );
      return;
    }
    if (password !== confirmPassword) {
      setError(
        language === "UA" ? "Паролі не збігаються" : language === "DE" ? "Die Passwörter stimmen nicht überein" : "Passwords don't match"
      );
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setError(translateUnknownError(updateError.message, language));
      return;
    }
    setSuccess(true);
    setTimeout(() => router.push("/dashboard"), 1800);
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-gray-900 rounded-2xl p-6 border border-white/10">
        {checkingLink ? (
          <div className="text-center py-8">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-400 text-sm">
              {language === "UA" ? "Перевіряємо посилання..." : language === "DE" ? "Link wird überprüft..." : "Checking your link..."}
            </p>
          </div>
        ) : !linkValid ? (
          <div className="text-center py-4">
            <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-7 h-7 text-red-400" />
            </div>
            <h2 className="text-lg font-semibold text-white mb-2">
              {language === "UA" ? "Посилання недійсне або протерміноване" : language === "DE" ? "Link ungültig oder abgelaufen" : "This link is invalid or expired"}
            </h2>
            <p className="text-sm text-gray-400 mb-6">
              {language === "UA"
                ? "Поверніться на головну сторінку і запросіть нове посилання для скидання пароля."
                : language === "DE"
                ? "Kehren Sie zur Startseite zurück und fordern Sie einen neuen Link zum Zurücksetzen des Passworts an."
                : "Go back to the homepage and request a new password reset link."}
            </p>
            <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={() => router.push("/")}>
              {language === "UA" ? "На головну" : language === "DE" ? "Zur Startseite" : "Go to homepage"}
            </Button>
          </div>
        ) : success ? (
          <div className="text-center py-4">
            <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-7 h-7 text-green-400" />
            </div>
            <h2 className="text-lg font-semibold text-white mb-2">
              {language === "UA" ? "Пароль оновлено" : language === "DE" ? "Passwort aktualisiert" : "Password updated"}
            </h2>
            <p className="text-sm text-gray-400">
              {language === "UA" ? "Перенаправляємо в кабінет..." : language === "DE" ? "Weiterleitung zum Dashboard..." : "Redirecting to your dashboard..."}
            </p>
          </div>
        ) : (
          <>
            <h2 className="text-2xl font-bold text-white mb-2">
              {language === "UA" ? "Створіть новий пароль" : language === "DE" ? "Neues Passwort erstellen" : "Create a new password"}
            </h2>
            <p className="text-gray-400 text-sm mb-6">
              {language === "UA"
                ? "Введіть новий пароль для вашого акаунта RIVANT."
                : language === "DE"
                ? "Geben Sie ein neues Passwort für Ihr RIVANT-Konto ein."
                : "Enter a new password for your RIVANT account."}
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">{passwordLabel}</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 pr-11 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 text-white text-base"
                    placeholder="••••••••"
                    minLength={6}
                    required
                    autoFocus
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
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">{confirmLabel}</label>
                <input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 text-white text-base"
                  placeholder="••••••••"
                  minLength={6}
                  required
                />
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? "..." : language === "UA" ? "Зберегти пароль" : language === "DE" ? "Passwort speichern" : "Save password"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
