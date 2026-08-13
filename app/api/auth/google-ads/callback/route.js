// app/api/auth/google-ads/callback/route.js
//
// Крок 2: Google повертає сюди після згоди користувача. Обмінюємо code на
// refresh_token і розгортаємо ПОВНУ ієрархію доступних рекламних акаунтів
// (listAdAccounts) — так не треба просити Customer ID вручну, і кожен акаунт
// вже приходить з правильним login-customer-id (працює для будь-якого
// користувача: своя ієрархія, чужий MCC, кілька MCC — без різниці).
// Якщо акаунт один — одразу підключаємо. Якщо кілька — кладемо тимчасові
// дані в httpOnly cookie (10 хв) і просимо обрати на дашборді
// (див. /api/auth/google-ads/pending і /finish).
import { NextResponse } from "next/server";
import { readState, exchangeCodeForTokens, listAdAccounts } from "@/lib/google-ads-oauth";
import { finalizeGoogleAdsConnection } from "@/lib/google-ads-connect";
import { encrypt } from "@/lib/crypto";

export const runtime = "nodejs";

const PENDING_COOKIE = "gads_pending";

function dashboardUrl(origin, params) {
  const url = new URL("/dashboard", origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

export async function GET(req) {
  const url = new URL(req.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  // Користувач натиснув "Cancel" на Google-формі згоди.
  if (oauthError) {
    return NextResponse.redirect(dashboardUrl(origin, { google_ads: "error", google_ads_error: oauthError }));
  }
  if (!code || !state) {
    return NextResponse.redirect(dashboardUrl(origin, { google_ads: "error", google_ads_error: "missing_code" }));
  }

  let email;
  try {
    email = readState(state);
  } catch (err) {
    console.error("google-ads oauth callback: bad state", err);
    return NextResponse.redirect(dashboardUrl(origin, { google_ads: "error", google_ads_error: "invalid_state" }));
  }

  try {
    const { accessToken, refreshToken } = await exchangeCodeForTokens({ origin, code });
    // accounts: [{ customerId, loginCustomerId, name }] — вже тільки кінцеві
    // рекламні акаунти, без менеджерських вузлів (їх обрати взагалі не можна).
    const accounts = await listAdAccounts(accessToken);

    if (accounts.length === 0) {
      return NextResponse.redirect(dashboardUrl(origin, { google_ads: "error", google_ads_error: "no_accounts" }));
    }

    if (accounts.length === 1) {
      await finalizeGoogleAdsConnection({ email, ...accounts[0], refreshToken });
      return NextResponse.redirect(dashboardUrl(origin, { google_ads: "connected" }));
    }

    // Кілька акаунтів під одним Google-логіном — секрети тимчасово в httpOnly
    // cookie, а не у відкритому query-параметрі, доки користувач не обере.
    const pending = encrypt(JSON.stringify({ email, refreshToken, accounts, ts: Date.now() }));
    const res = NextResponse.redirect(dashboardUrl(origin, { google_ads: "pick" }));
    res.cookies.set(PENDING_COOKIE, pending, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return res;
  } catch (err) {
    console.error("google-ads oauth callback error:", err);
    return NextResponse.redirect(dashboardUrl(origin, { google_ads: "error", google_ads_error: err.message }));
  }
}