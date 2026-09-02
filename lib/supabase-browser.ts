"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// FIX (аудит preLaunch): раньше createClient() вызывался напрямую в каждом
// компоненте (navbar.tsx, dashboard/page.tsx, pricing-section.tsx,
// reset-password/page.tsx, PaymentModal.tsx, crypto-checkout-modal.tsx,
// AddonCheckoutModal.tsx) и КАЖДЫЙ вызов создавал НОВЫЙ экземпляр
// GoTrueClient (видно в консоли как "Multiple GoTrueClient instances
// detected"). Это не просто предупреждение — это реальная race condition:
//
// После входа через Google браузер возвращается на /dashboard?code=...
// (PKCE-флоу). Новосозданный клиент асинхронно меняет code на сессию и
// пишет её в localStorage. Но app/dashboard/page.tsx в самом первом
// useEffect сразу зовёт supabase.auth.getSession() — если это случилось
// РАНЬШЕ, чем завершился обмен code -> session у только что созданного
// инстанса, getSession() честно возвращает null, и человека тут же кидает
// на "/", хотя вход по факту только что прошёл успешно. Именно поэтому
// второй клик по "Войти через Google" срабатывает мгновенно — сессия к
// этому моменту уже физически лежит в storage от первой попытки.
//
// Фикс: один-единственный экземпляр клиента на весь браузерный контекст
// (module-level singleton). Все компоненты, зовущие createClient(),
// получают ОДИН и тот же объект без единой правки в них самих — обмен
// code -> session и последующий getSession() теперь всегда идут через один
// и тот же GoTrueClient и не гонятся друг с другом.
let client: SupabaseClient | undefined;

export function createClient() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return client;
}