// app/api/auth/quickbooks/callback/route.js
//
// Крок 2: Intuit повертає сюди code + realmId (ID обраної компанії) після
// згоди користувача. На відміну від Google Ads тут НЕМАЄ кроку розгортання
// ієрархії акаунтів — realmId вже єдиний і остаточний, тому підключення
// завершується одразу, без /pending і /finish.
import { NextResponse } from "next/server";
import { readState, exchangeCodeForTokens } from "@/lib/quickbooks-oauth";
import { finalizeQuickbooksConnection } from "@/lib/quickbooks-connect";

export const runtime = "nodejs";

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
  const realmId = url.searchParams.get("realmId");
  const oauthError = url.searchParams.get("error");

  // Користувач натиснув "Cancel" на екрані згоди Intuit.
  if (oauthError) {
    return NextResponse.redirect(dashboardUrl(origin, { quickbooks: "error", quickbooks_error: oauthError }));
  }
  if (!code || !state || !realmId) {
    return NextResponse.redirect(dashboardUrl(origin, { quickbooks: "error", quickbooks_error: "missing_code" }));
  }

  let email;
  try {
    email = readState(state);
  } catch (err) {
    console.error("quickbooks oauth callback: bad state", err);
    return NextResponse.redirect(dashboardUrl(origin, { quickbooks: "error", quickbooks_error: "invalid_state" }));
  }

  try {
    const { refreshToken } = await exchangeCodeForTokens({ origin, code });
    await finalizeQuickbooksConnection({ email, realmId, refreshToken });
    return NextResponse.redirect(dashboardUrl(origin, { quickbooks: "connected" }));
  } catch (err) {
    console.error("quickbooks oauth callback error:", err);
    return NextResponse.redirect(dashboardUrl(origin, { quickbooks: "error", quickbooks_error: err.message }));
  }
}
