// lib/google-ads-oauth.js
//
// Хелперы для упрощённого OAuth-подключення Google Ads (замінює ручний ввід
// Client ID/Secret/Developer Token і добування refresh token через Google
// OAuth Playground — див. app/api/auth/google-ads/{start,callback,pending,finish}).
//
// OAuth Client ID/Secret і Developer Token тепер app-wide (env-змінні нижче),
// їх один раз налаштовує власник платформи в Google Cloud Console / Google Ads
// API Center — користувачу лишається тільки натиснути "Підключити Google Ads"
// і, якщо в нього кілька акаунтів, обрати Customer ID.
const { encrypt, decrypt } = require("./crypto");

const SCOPE = "https://www.googleapis.com/auth/adwords";
const GOOGLE_ADS_API_VERSION = "v24";
// 10 хвилин — достатньо, щоб пройти Google-форму згоди, але коротко живе,
// якщо state перехоплять.
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

function getRedirectUri(origin) {
  return `${origin}/api/auth/google-ads/callback`;
}

// state шифрується тим самим ключем (ENCRYPTION_KEY), що й креди інтеграцій —
// GCM auth tag одразу захищає його від підробки, окремий підпис не потрібен.
function buildAuthUrl({ origin, email }) {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_ADS_CLIENT_ID is not set on the server");

  const state = encrypt(JSON.stringify({ email, ts: Date.now() }));
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(origin),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    // prompt=consent гарантує, що Google щоразу поверне refresh_token, навіть
    // якщо користувач вже давав згоду цьому додатку раніше.
    // select_account примушує Google завжди показувати вибір акаунта, а не
    // мовчки використовувати вже активну сесію в браузері (саме через це
    // раніше завжди авторизовувався не той Google-акаунт).
    prompt: "select_account consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function readState(state) {
  const payload = JSON.parse(decrypt(state));
  if (!payload?.email || !payload?.ts) throw new Error("invalid_state");
  if (Date.now() - payload.ts > STATE_MAX_AGE_MS) throw new Error("state_expired");
  return payload.email;
}

async function exchangeCodeForTokens({ origin, code }) {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("google_ads_oauth_not_configured");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getRedirectUri(origin),
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "token_exchange_failed");
  }
  if (!data.refresh_token) {
    // Рідкісний edge case: Google не завжди повертає новий refresh_token навіть
    // з prompt=consent, якщо додаток уже мав активний grant з іншим OAuth-клієнтом.
    throw new Error("no_refresh_token");
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

// Повертає всі Customer ID, до яких є доступ у щойно виданого refresh_token
// (через access_token) — так користувачу не треба вручну шукати й вводити
// свій Customer ID.
async function listAccessibleCustomers(accessToken) {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) throw new Error("google_ads_developer_token_not_configured");

  const res = await fetch(
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": developerToken,
      },
    }
  );
  const data = await res.json();
  if (!res.ok) {
    const message = data?.error?.message || data?.[0]?.error?.message || res.status;
    throw new Error(`google_ads_api_error: ${message}`);
  }
  // resourceNames приходять як "customers/1234567890"
  return (data.resourceNames || []).map((rn) => rn.split("/")[1]).filter(Boolean);
}

module.exports = { buildAuthUrl, readState, exchangeCodeForTokens, listAccessibleCustomers };