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

function extractErrorMessage(data) {
  const topMessage = data?.error?.message || data?.[0]?.error?.message;
  const nestedErrors = data?.error?.details?.flatMap((d) => d.errors || []) || [];
  const nestedMessage = nestedErrors.map((e) => e.message).filter(Boolean).join("; ");
  return nestedMessage || topMessage || null;
}

// Повертає всі Customer ID, до яких є доступ у щойно виданого refresh_token
// (через access_token) — так користувачу не треба вручну шукати й вводити
// свій Customer ID. Це "плоский" список — може містити і MCC (менеджерські
// акаунти), і звичайні рекламні акаунти впереміш, без ієрархії.
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
    // Google Ads REST API часто повертає generic-обгортку в error.message
    // ("Request is missing required authentication credential..."), а
    // справжня причина лежить глибше — в error.details[].errors[].message.
    // Раніше ми читали тільки верхній рівень і бачили фейкову причину.
    const message = extractErrorMessage(data) || res.status;
    console.error("listAccessibleCustomers failed:", JSON.stringify({ raw: data }));
    throw new Error(`google_ads_api_error: ${message}`);
  }
  // resourceNames приходять як "customers/1234567890"
  return (data.resourceNames || []).map((rn) => rn.split("/")[1]).filter(Boolean);
}

// Для одного "seed" акаунта (елемента з listAccessibleCustomers) розгортає
// його ієрархію через customer_client: якщо seed — MCC, повертає всі
// вкладені акаунти (в т.ч. вкладені MCC на нижчих рівнях); якщо seed —
// звичайний рекламний акаунт без дітей, повертає порожній список, і викликач
// сам додає seed як самостійний акаунт (без login-customer-id).
//
// login-customer-id для цього запиту = сам seed: щоб запитати "хто мої діти",
// менеджер завжди звертається сам до себе, а не через ще одного менеджера.
async function queryCustomerClients(accessToken, developerToken, seedCustomerId) {
  const query = `
    SELECT
      customer_client.id,
      customer_client.client_customer,
      customer_client.level,
      customer_client.manager,
      customer_client.descriptive_name
    FROM customer_client
    WHERE customer_client.level <= 5
  `.trim();

  const res = await fetch(
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${seedCustomerId}/googleAds:search`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": developerToken,
        "login-customer-id": seedCustomerId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    // Якщо seed — не менеджер, цей запит цілком очікувано впаде (у звичайного
    // рекламного акаунта немає ресурсу customer_client з дітьми). Це не
    // помилка користувача, просто ознака "це кінцевий акаунт" — обробляємо
    // вище, у listAdAccounts.
    return [];
  }
  return data.results || [];
}

// Головна функція для UI вибору акаунта: розгортає ПОВНУ ієрархію
// доступних акаунтів (незалежно від того, є в користувача свій MCC чи ні, і
// незалежно від того, чий саме це MCC — працює однаково для будь-якого
// користувача) і повертає тільки кінцеві рекламні акаунти (без менеджерських
// вузлів — по них немає кампаній/витрат), кожен вже з правильним
// login-customer-id для запитів метрик.
async function listAdAccounts(accessToken) {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) throw new Error("google_ads_developer_token_not_configured");

  const seedIds = await listAccessibleCustomers(accessToken);
  const accounts = [];

  for (const seedId of seedIds) {
    const rows = await queryCustomerClients(accessToken, developerToken, seedId);

    if (rows.length === 0) {
      // seed сам по собі не менеджер (або менеджер без дітей) — трактуємо
      // як самостійний рекламний акаунт, login-customer-id йому не треба.
      accounts.push({ customerId: seedId, loginCustomerId: null, name: null });
      continue;
    }

    for (const row of rows) {
      const c = row.customerClient || {};
      if (c.manager) continue; // пропускаємо вкладені менеджерські вузли
      const id = c.clientCustomer ? c.clientCustomer.split("/")[1] : null;
      if (!id) continue;
      accounts.push({
        customerId: id,
        loginCustomerId: seedId,
        name: c.descriptiveName || null,
      });
    }
  }

  // Дедуплікація — той самий кінцевий акаунт міг прийти через кілька seed
  // (наприклад, якщо користувач має прямий доступ і доступ через MCC одночасно).
  const seen = new Set();
  return accounts.filter((a) => {
    if (seen.has(a.customerId)) return false;
    seen.add(a.customerId);
    return true;
  });
}

module.exports = {
  buildAuthUrl,
  readState,
  exchangeCodeForTokens,
  listAccessibleCustomers,
  listAdAccounts,
};