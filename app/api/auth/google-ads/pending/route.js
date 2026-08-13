// app/api/auth/google-ads/pending/route.js
//
// Використовується дашбордом, коли після /callback у користувача виявилось
// кілька рекламних акаунтів (?google_ads=pick). Читає httpOnly cookie
// gads_pending і віддає клієнту ТІЛЬКИ список акаунтів для вибору (id +
// назва, якщо Google її повернув) — refresh_token і login-customer-id
// кожного акаунта лишаються на сервері й ніколи не йдуть у відкритому
// вигляді туди, де їх можна підмінити.
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
    // Клієнту віддаємо тільки те, що потрібно для UI вибору: id і назву.
    // login-customer-id лишається на сервері й повертається тільки з /finish
    // після того, як сервер сам звірить обраний customerId зі списком.
    const accounts = (data.accounts || []).map((a) => ({
      customerId: a.customerId,
      name: a.name || a.customerId,
    }));
    return Response.json({ accounts, email: data.email });
  } catch (err) {
    console.error("google-ads pending read error:", err);
    return Response.json({ error: "invalid_pending_connection" }, { status: 400 });
  }
}