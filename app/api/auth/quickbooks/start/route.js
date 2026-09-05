// app/api/auth/quickbooks/start/route.js
//
// Крок 1: картка на дашборді (oauthStartHref) веде сюди звичайним лінком —
// одразу редиректимо на Intuit consent screen. Той самий паттерн, що і
// app/api/auth/google-ads/start/route.js.
import { NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/quickbooks-oauth";
import { requireUser, UnauthorizedError, unauthorizedResponse } from "@/lib/require-user";

export const runtime = "nodejs";

export async function GET(req) {
  const url = new URL(req.url);

  // Той самий фікс, що і в app/api/auth/google-ads/start/route.js (п. 1
  // аудиту): email береться ЛИШЕ з реальної сесії поточного користувача,
  // а не з query — інакше будь-хто міг би запустити OAuth від чужого
  // імені, підставивши email у посилання.
  let email;
  try {
    const user = await requireUser();
    email = user.email;
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedResponse();
    throw err;
  }

  try {
    const authUrl = buildAuthUrl({ origin: url.origin, email });
    return NextResponse.redirect(authUrl);
  } catch (err) {
    console.error("quickbooks oauth start error:", err);
    const back = new URL("/dashboard", url.origin);
    back.searchParams.set("quickbooks", "error");
    back.searchParams.set("quickbooks_error", err.message);
    return NextResponse.redirect(back);
  }
}
