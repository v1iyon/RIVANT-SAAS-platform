// lib/quickbooks-oauth.js
//
// OAuth2-хелпери для QuickBooks Online (Intuit) — той самий паттерн, що й
// lib/google-ads-oauth.js: користувач не вводить жодних ключів вручну,
// тільки натискає "Підключити" і проходить Intuit consent screen.
//
// НА ВІДМІНУ ВІД Google Ads тут НЕ потрібен окремий крок "розгорнути
// ієрархію акаунтів" — Intuit сам показує користувачу список його компаній
// на власному екрані вибору (якщо їх кілька) і повертає РІВНО ОДИН realmId
// (ідентифікатор обраної компанії) прямо в query callback'а. Тому немає
// /pending, /finish і жодної модалки вибору на нашій стороні — на відміну
// від google-ads, тут одразу один HTTP redirect → одна компанія → готово.
//
// ВАЖЛИВО (є принципова відмінність від Google Ads/Meta Ads, треба знати
// ДО продакшн-запуску): Google Ads Basic Access і Meta Marketing API
// System User токен не вимагають формального рев'ю додатку перед тим, як
// РЕАЛЬНІ клієнти зможуть підключитись. Intuit — вимагає. Production Keys
// для QuickBooks App видаються тільки після проходження Intuit App Review
// (заповнена анкета, скріншоти OAuth-флоу, política приватності тощо,
// зазвичай кілька робочих днів). До проходження рев'ю додаток працює лише
// в Sandbox-режимі з тестовими компаніями Intuit Developer акаунта — жоден
// реальний клієнт RIVANT підключити свій QuickBooks не зможе. Це треба
// зробити один раз на рівні платформи (developer.intuit.com → ваш app →
// Production Settings → Complete App Checklist), а не на рівні коду.
//
// QUICKBOOKS_ENVIRONMENT керує тим, який API-хост і токен-ендпоінт
// використовується: "sandbox" (за замовчуванням, поки Production Keys не
// затверджено) чи "production". Client ID/Secret у Intuit РІЗНІ для
// sandbox і production навіть у межах одного застосунку — обидва набори
// видаються одразу в Intuit Developer Dashboard, перемикати можна без
// нового деплою, просто змінивши QUICKBOOKS_ENVIRONMENT + відповідні
// CLIENT_ID/SECRET у Vercel.
const { encrypt, decrypt } = require("./crypto");

const SCOPE = "com.intuit.quickbooks.accounting";
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

function isProduction() {
  return (process.env.QUICKBOOKS_ENVIRONMENT || "sandbox") === "production";
}

// Sandbox і production компанії живуth на ОДНОМУ й тому самому API-хості
// (quickbooks.api.intuit.com) — на відміну від token-ендпоінта, який теж
// спільний. Sandbox/production різниться лише тим, ДО ЯКОЇ компанії
// прив'язаний realmId і які Client ID/Secret видав OAuth — самого окремого
// "sandbox-хоста" для Accounting API, на відміну від деяких інших Intuit
// продуктів, не існує.
const API_BASE = "https://quickbooks.api.intuit.com";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";

function getRedirectUri(origin) {
  return `${origin}/api/auth/quickbooks/callback`;
}

function getClientCredentials() {
  const clientId = isProduction() ? process.env.QUICKBOOKS_CLIENT_ID : process.env.QUICKBOOKS_SANDBOX_CLIENT_ID;
  const clientSecret = isProduction() ? process.env.QUICKBOOKS_CLIENT_SECRET : process.env.QUICKBOOKS_SANDBOX_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      isProduction()
        ? "QUICKBOOKS_CLIENT_ID/QUICKBOOKS_CLIENT_SECRET is not set on the server"
        : "QUICKBOOKS_SANDBOX_CLIENT_ID/QUICKBOOKS_SANDBOX_CLIENT_SECRET is not set on the server"
    );
  }
  return { clientId, clientSecret };
}

// state шифрується тим самим ключем, що й у google-ads-oauth.js — GCM auth
// tag сам захищає від підробки, окремий підпис не потрібен.
function buildAuthUrl({ origin, email }) {
  const { clientId } = getClientCredentials();

  const state = encrypt(JSON.stringify({ email, ts: Date.now() }));
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(origin),
    response_type: "code",
    scope: SCOPE,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

function readState(state) {
  const payload = JSON.parse(decrypt(state));
  if (!payload?.email || !payload?.ts) throw new Error("invalid_state");
  if (Date.now() - payload.ts > STATE_MAX_AGE_MS) throw new Error("state_expired");
  return payload.email;
}

async function exchangeCodeForTokens({ origin, code }) {
  const { clientId, clientSecret } = getClientCredentials();
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: getRedirectUri(origin),
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token || !data.refresh_token) {
    throw new Error(data.error_description || data.error || "token_exchange_failed");
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

// Викликається на КОЖНОМУ прогоні синку (scripts/quickbooks-sync.mjs) —
// access_token живе ~1 годину. КРИТИЧНО (на відміну від Google, де
// refresh_token не змінюється при рефреші): Intuit ЗАВЖДИ повертає новий
// refresh_token у відповіді на кожен виклик refresh_token grant, і стара
// версія стає недійсною. Якщо не зберегти новий refresh_token одразу після
// цього виклику — наступний прогін синку впаде з invalid_grant, навіть
// якщо клієнт нічого не відкликав і нічого не зламав. Тому ця функція
// повертає ОБИДВА токени, а виклик у quickbooks-sync.mjs зобов'язаний
// перезаписати збережений refresh_token щоразу, а не лише access_token.
async function refreshAccessToken(refreshToken) {
  const { clientId, clientSecret } = getClientCredentials();
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token || !data.refresh_token) {
    throw new Error(data.error_description || data.error || "token_refresh_failed");
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

module.exports = {
  API_BASE,
  buildAuthUrl,
  readState,
  exchangeCodeForTokens,
  refreshAccessToken,
  isProduction,
};
