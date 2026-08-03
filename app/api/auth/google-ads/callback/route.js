// app/api/auth/google-ads/callback/route.js
//
// Крок 2: Google повертає сюди після згоди користувача. Обмінюємо code на
// refresh_token і дізнаємось, до яких Google Ads акаунтів є доступ
// (listAccessibleCustomers) — так не треба просити Customer ID вручну.
// Якщо акаунт один — одразу підключаємо. Якщо кілька — кладемо тимчасові
// дані в httpOnly cookie (10 хв) і просимо обрати на дашборді
// (див. /api/auth/google-ads/pending і /finish).
import { NextResponse } from "next/server";
import { readState, exchangeCodeForTokens, listAccessibleCustomers } from "@/lib/google-ads-oauth";
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
    const customerIds = await listAccessibleCustomers(accessToken);

    if (customerIds.length === 0) {
      return NextResponse.redirect(dashboardUrl(origin, { google_ads: "error", google_ads_error: "no_accounts" }));
    }

    if (customerIds.length === 1) {
      await finalizeGoogleAdsConnection({ email, customerId: customerIds[0], refreshToken });
      return NextResponse.redirect(dashboardUrl(origin, { google_ads: "connected" }));
    }

    // Кілька акаунтів під одним Google-логіном — секрети тимчасово в httpOnly
    // cookie, а не у відкритому query-параметрі, доки користувач не обере.
    const pending = encrypt(JSON.stringify({ email, refreshToken, customerIds, ts: Date.now() }));
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