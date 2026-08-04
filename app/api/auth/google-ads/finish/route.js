// app/api/auth/google-ads/finish/route.js
//
// Крок 3 (тільки коли акаунтів кілька): користувач обрав Customer ID у
// picker-модалці на дашборді (див. IntegrationConnectCard / dashboard/page.tsx).
// Дочитуємо refresh_token з httpOnly cookie gads_pending, зберігаємо
// інтеграцію тим самим шляхом, що й /callback для одного акаунта, і чистимо cookie.
import { NextResponse } from "next/server";
import { decrypt } from "@/lib/crypto";
import { finalizeGoogleAdsConnection } from "@/lib/google-ads-connect";

export const runtime = "nodejs";

const PENDING_COOKIE = "gads_pending";
const MAX_AGE_MS = 10 * 60 * 1000;

export async function POST(req) {
  try {
    const { customerId } = await req.json();
    if (!customerId) {
      return Response.json({ error: "customerId is required" }, { status: 400 });
    }

    const cookie = req.cookies.get(PENDING_COOKIE)?.value;
    if (!cookie) {
      return Response.json({ error: "No pending connection — try connecting again" }, { status: 404 });
    }

    const data = JSON.parse(decrypt(cookie));
    if (Date.now() - data.ts > MAX_AGE_MS) {
      return Response.json({ error: "Expired — try connecting again" }, { status: 410 });
    }
    if (!data.customerIds.includes(customerId)) {
      return Response.json({ error: "That account isn't in your accessible accounts" }, { status: 400 });
    }

    await finalizeGoogleAdsConnection({
      email: data.email,
      customerId,
      refreshToken: data.refreshToken,
    });

    const res = NextResponse.json({ success: true, email: data.email });
    res.cookies.set(PENDING_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  } catch (err) {
    console.error("google-ads oauth finish error:", err);
    return Response.json({ error: err.message || "Server error" }, { status: 500 });
  }
}
