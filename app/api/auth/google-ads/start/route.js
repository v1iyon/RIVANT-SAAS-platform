// app/api/auth/google-ads/start/route.js
//
// Крок 1 спрощеного підключення Google Ads: одразу редіректимо на Google
// consent screen замість того, щоб просити користувача вручну створювати
// OAuth Client ID/Secret у Google Cloud Console і добувати refresh token
// через Google OAuth Playground (старий флоу — див. git-історію
// components/dashboard/integration-connect-card.tsx).
import { NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/google-ads-oauth";

export const runtime = "nodejs";

export async function GET(req) {
  const url = new URL(req.url);
  const email = url.searchParams.get("email");
  if (!email) {
    return Response.json({ error: "email is required" }, { status: 400 });
  }

  try {
    const authUrl = buildAuthUrl({ origin: url.origin, email });
    return NextResponse.redirect(authUrl);
  } catch (err) {
    console.error("google-ads oauth start error:", err);
    const back = new URL("/dashboard", url.origin);
    back.searchParams.set("google_ads", "error");
    back.searchParams.set("google_ads_error", err.message);
    return NextResponse.redirect(back);
  }
}
