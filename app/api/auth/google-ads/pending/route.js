// app/api/auth/google-ads/pending/route.js
//
// Використовується дашбордом, коли після /callback у користувача виявилось
// кілька Google Ads акаунтів (?google_ads=pick). Читає httpOnly cookie
// gads_pending і віддає клієнту ТІЛЬКИ список Customer ID для вибору —
// refresh_token лишається на сервері й ніколи не йде в браузер.
import { decrypt } from "@/lib/crypto";

export const runtime = "nodejs";

const PENDING_COOKIE = "gads_pending";
const MAX_AGE_MS = 10 * 60 * 1000;

export async function GET(req) {
  const cookie = req.cookies.get(PENDING_COOKIE)?.value;
  if (!cookie) {
    return Response.json({ error: "no_pending_connection" }, { status: 404 });
  }

  try {
    const data = JSON.parse(decrypt(cookie));
    if (Date.now() - data.ts > MAX_AGE_MS) {
      return Response.json({ error: "expired" }, { status: 410 });
    }
    return Response.json({ customerIds: data.customerIds, email: data.email });
  } catch (err) {
    console.error("google-ads pending read error:", err);
    return Response.json({ error: "invalid_pending_connection" }, { status: 400 });
  }
}
