// app/api/auth/google-ads/start/route.js
//
// Крок 1 спрощеного підключення Google Ads: одразу редіректимо на Google
// consent screen замість того, щоб просити користувача вручну створювати
// OAuth Client ID/Secret у Google Cloud Console і добувати refresh token
// через Google OAuth Playground (старий флоу — див. git-історію
// components/dashboard/integration-connect-card.tsx).
import { NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/google-ads-oauth";
import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/require-user";

export const runtime = "nodejs";

export async function GET(req) {
  const url = new URL(req.url);

  // п. 1 аудита: email больше не берём из query — раньше это позволяло
  // запустить OAuth от имени любого чужого email без входа в его аккаунт
  // (email из query клался в state и слепо доверялся в callback). Теперь
  // берём email ТОЛЬКО из реальной сессии текущего пользователя, как и в
  // остальных роутах (/api/metrics, /api/export-data, /api/delete-account).
  let email;
  try {
    const user = await requireUser();
    email = user.email;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return unauthorizedResponse();
    }
    throw err;
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