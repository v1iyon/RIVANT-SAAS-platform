// lib/error-messages.ts
//
// Единый словарь для общих (не auth-специфичных) ошибок интерфейса —
// оплата, экспорт данных, удаление аккаунта, сетевые сбои и т.п. Раньше
// такие места точечно звали alert("Не удалось открыть окно оплаты") /
// alert("Не вдалося оформити заявку...") / "Something went wrong" —
// хардкод на случайном языке, не зависящий от language пользователя.
// См. п. 11 аудита.
//
// Для auth-ошибок (login/signup/2FA) в navbar.tsx уже есть отдельный
// translateAuthError с собственным набором ключей — это НЕ дублирование
// на пустом месте: auth-ошибки приходят из Supabase (email/password-специфичные
// сообщения), а этот файл — для остальных мест сайта (dashboard, pricing,
// формы), которые раньше вообще не были локализованы.

import type { Language } from "@/lib/translations";

type ErrorDict = Record<string, Record<Language, string>>;

const COMMON_ERRORS: ErrorDict = {
  generic: {
    EN: "Something went wrong. Please try again.",
    UA: "Щось пішло не так. Спробуйте ще раз.",
    DE: "Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.",
  },
  network: {
    EN: "Network error. Please check your connection and try again.",
    UA: "Помилка мережі. Перевірте з'єднання і спробуйте ще раз.",
    DE: "Netzwerkfehler. Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut.",
  },
  paymentWindowFailed: {
    EN: "Couldn't open the payment window. Please try again.",
    UA: "Не вдалося відкрити вікно оплати. Спробуйте ще раз.",
    DE: "Das Zahlungsfenster konnte nicht geöffnet werden. Bitte versuchen Sie es erneut.",
  },
  requestFailed: {
    EN: "Couldn't submit the request. Please try again.",
    UA: "Не вдалося оформити заявку, спробуйте ще раз.",
    DE: "Die Anfrage konnte nicht gesendet werden. Bitte versuchen Sie es erneut.",
  },
  couldNotGetLink: {
    EN: "Couldn't get the connection link. Please try again.",
    UA: "Не вдалося отримати посилання для підключення. Спробуйте ще раз.",
    DE: "Der Verbindungslink konnte nicht abgerufen werden. Bitte versuchen Sie es erneut.",
  },
};

export type CommonErrorKey = keyof typeof COMMON_ERRORS;

/**
 * Возвращает локализованный текст для одного из общих кодов ошибок
 * (см. COMMON_ERRORS выше). Неизвестный ключ тихо падает на "generic",
 * чтобы никогда не показать пользователю пустую строку или "undefined".
 */
export function commonError(key: string, language: Language): string {
  const entry = COMMON_ERRORS[key] || COMMON_ERRORS.generic;
  return entry[language] || entry.EN;
}

/**
 * Пытается перевести "сырое" сообщение об ошибке (обычно английский текст
 * от Supabase/сети — error.message) на текущий язык интерфейса по паттернам
 * в нижнем регистре. Если ни один паттерн не подошёл — честный дженерик
 * текст на нужном языке, а не сырой английский текст библиотеки.
 */
export function translateUnknownError(rawMessage: string | null | undefined, language: Language): string {
  const msg = (rawMessage || "").toLowerCase();

  if (!msg) return commonError("generic", language);
  if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("load failed")) {
    return commonError("network", language);
  }
  if (msg.includes("password") && (msg.includes("short") || msg.includes("6 char") || msg.includes("at least"))) {
    const dict: Record<Language, string> = {
      EN: "Password must be at least 6 characters.",
      UA: "Пароль має містити щонайменше 6 символів.",
      DE: "Das Passwort muss mindestens 6 Zeichen lang sein.",
    };
    return dict[language] || dict.EN;
  }
  if (msg.includes("same password") || msg.includes("should be different")) {
    const dict: Record<Language, string> = {
      EN: "New password must be different from the current one.",
      UA: "Новий пароль має відрізнятися від поточного.",
      DE: "Das neue Passwort muss sich vom aktuellen unterscheiden.",
    };
    return dict[language] || dict.EN;
  }
  if (msg.includes("rate limit") || msg.includes("too many requests")) {
    const dict: Record<Language, string> = {
      EN: "Too many attempts. Please wait a moment and try again.",
      UA: "Забагато спроб. Зачекайте трохи і спробуйте ще раз.",
      DE: "Zu viele Versuche. Bitte warten Sie einen Moment und versuchen Sie es erneut.",
    };
    return dict[language] || dict.EN;
  }

  return commonError("generic", language);
}