// scripts/quickbooks-sync.mjs
//
// Sync-модуль для QuickBooks Online. Паттерн 1:1 з paypal-sync.mjs і
// shopify-sync.mjs, з двома суттєвими відмінностями:
//
// 1. АВТЕНТИФІКАЦІЯ — на відміну від PayPal/Mollie (client_credentials на
//    ВЛАСНИЙ акаунт клієнта), QuickBooks підключається через повний
//    3-legged OAuth (lib/quickbooks-oauth.js, app/api/auth/quickbooks/*).
//    access_token живе ~1 годину, тому КОЖЕН прогін синку спершу міняє
//    збережений refresh_token на нову пару access+refresh. Intuit ЗАВЖДИ
//    повертає НОВИЙ refresh_token при рефреші, і стара версія стає
//    недійсною — тому нову пару зберігаємо в integrations.config ОДРАЗУ,
//    до будь-яких API-запитів. Якщо цього не зробити, наступний прогін
//    впаде з invalid_grant навіть без жодних дій клієнта.
//
// 2. REVENUE_MODE — QuickBooks, як і Shopify/WooCommerce (і на відміну від
//    PayPal/Mollie), може бути як "тими самими грошима", що вже пройшли
//    через Stripe/інший процесор (типовий кейс: банк-фід у QuickBooks
//    просто відображає ті самі депозити), так і ЄДИНИМ джерелом правди про
//    дохід (типовий кейс: сервісний/консалтинговий бізнес без онлайн-
//    чекауту, що виставляє інвойси і фіксує оплати вручну в QuickBooks).
//    Тому revenue_mode ("replace"/"add") тут підтримується так само, як і
//    для Shopify/WooCommerce — див. lib/revenue-mode.js.
//
// СВІДОМО НЕ РОБИМО В ЦІЙ ВЕРСІЇ: синк витрат (Purchase/Bill) у expenses.
// public.expenses.category має жорсткий CHECK-констрейнт лише на
// 'advertising' | 'shipping' | 'cost_of_goods' | 'other' (див. фікс від
// 03.09.2026 у shopify-sync.mjs), а категорії рахунків у QuickBooks
// довільні для кожної компанії (Chart of Accounts) — коректний мапінг
// вимагає окремого UI, де клієнт сам зіставляє свої категорії з цими
// чотирма, а не еврестичного вгадування тут. Дохід синкається вже зараз;
// витрати — окрема майбутня задача.
//
// Джерела доходу: Payment (оплата інвойса) + SalesReceipt (продаж без
// інвойсу, типовий POS/одноразовий кейс) — разом покривають обидва
// стандартні способи, якими гроші потрапляють у QuickBooks як дохід.
import { createClient } from "@supabase/supabase-js";
import { decrypt, encrypt } from "../lib/crypto.js";
import { logError } from "../lib/log-error.js";
import { sendAlertToBusiness, getUserContact } from "../lib/alerts.mjs";
import { refreshAccessToken, API_BASE } from "../lib/quickbooks-oauth.js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const SYNC_FAILURE_MESSAGE = {
  UA: () => `Не вдалося синхронізувати QuickBooks`,
  EN: () => `Failed to sync QuickBooks`,
  DE: () => `QuickBooks Synchronisierung fehlgeschlagen`,
};

function getSyncFailureReason(error) {
  const message = String(error?.message || "").toLowerCase();
  // invalid_grant — типово протермінований (>100 днів без використання)
  // чи відкликаний користувачем на appcenter.intuit.com refresh_token.
  // На відміну від "access_denied" в інших провайдерах, це НЕ можна
  // полагодити перевіркою ключа в налаштуваннях — треба повне повторне
  // підключення через кнопку "Підключити" (новий OAuth-редирект).
  if (message.includes("invalid_grant") || message.includes("token_refresh_failed")) return "reauth_required";
  if (message.includes("401") || message.includes("unauthorized")) return "access_denied";
  if (message.includes("403")) return "missing_scope";
  if (message.includes("429") || message.includes("throttle")) return "rate_limited";
  return "connection_failed";
}

const SYNC_FAILURE_EXPLANATION = {
  UA: {
    reauth_required: "QuickBooks відкликав доступ або термін дії сплив — натисніть \"Підключити\" ще раз у картці QuickBooks.",
    access_denied: "QuickBooks відхилив запит на авторизацію — спробуйте перепідключити інтеграцію.",
    missing_scope: "Немає доступу до бухгалтерських даних цієї компанії QuickBooks — перевірте права застосунку.",
    rate_limited: "QuickBooks тимчасово обмежив кількість запитів — синхронізація відновиться на наступному прогоні.",
    connection_failed: "Тимчасова помилка з'єднання з QuickBooks — перевірте статус інтеграції.",
  },
  EN: {
    reauth_required: "QuickBooks revoked access or the connection expired — click \"Connect\" again on the QuickBooks card.",
    access_denied: "QuickBooks rejected the authorization request — try reconnecting the integration.",
    missing_scope: "No access to this QuickBooks company's accounting data — check the app's permissions.",
    rate_limited: "QuickBooks temporarily rate-limited requests — sync will resume on the next run.",
    connection_failed: "Temporary connection issue with QuickBooks — check the integration status.",
  },
  DE: {
    reauth_required: "QuickBooks hat den Zugriff widerrufen oder er ist abgelaufen — klicken Sie erneut auf \"Verbinden\".",
    access_denied: "QuickBooks hat die Autorisierungsanfrage abgelehnt — verbinden Sie die Integration erneut.",
    missing_scope: "Kein Zugriff auf die Buchhaltungsdaten dieser QuickBooks-Firma — Berechtigungen der App prüfen.",
    rate_limited: "QuickBooks hat Anfragen vorübergehend limitiert — die Synchronisierung wird beim nächsten Lauf fortgesetzt.",
    connection_failed: "Vorübergehendes Verbindungsproblem mit QuickBooks — prüfen Sie den Integrationsstatus.",
  },
};

async function getBusinessUserId(businessId) {
  const { data } = await admin.from("businesses").select("user_id").eq("id", businessId).maybeSingle();
  return data?.user_id ?? null;
}

// QBO Query API — SQL-подібна мова, без чанкінгу по датах (на відміну від
// PayPal тут немає ліміту в 31 день на запит), лише пагінація по
// STARTPOSITION. minorversion=65 — остання стабільна на момент написання,
// не впливає на форму відповіді Payment/SalesReceipt, які тут читаються.
async function queryEntities(accessToken, realmId, entity, sinceDateStr) {
  const all = [];
  const pageSize = 1000;
  let startPosition = 1;
  for (let guard = 0; guard < 50; guard++) {
    // 50 сторінок по 1000 = 50 000 записів — з великим запасом навіть для
    // 365-денного бекфілу активного бізнесу.
    const sql = `SELECT * FROM ${entity} WHERE TxnDate >= '${sinceDateStr}' ORDERBY TxnDate STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`;
    const url = `${API_BASE}/v3/company/${realmId}/query?query=${encodeURIComponent(sql)}&minorversion=65`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`QuickBooks query error (${entity}): ${res.status} ${body}`.slice(0, 300));
    }
    const data = await res.json();
    const rows = data?.QueryResponse?.[entity] || [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    startPosition += pageSize;
  }
  return all;
}

// Той самий "replace тому Stripe вже порахував ці гроші" / "add — окремий
// потік" вибір, що і upsertShopifyRevenue у shopify-sync.mjs, включно з
// delta-пам'яттю проти задвоєння при погодинному синку з вікном, що
// перекривається. Окремий memo-ключ (quickbooks_revenue_memo) живе на
// ЦІЙ integrations-строчці, тож не конфліктує з shopify_revenue_memo/
// paypal_revenue_memo інших підключень того ж бізнесу.
async function upsertQuickbooksRevenue({ integrationId, integrationConfig, businessId, date, revenue, orders, revenueMode }) {
  const { data: existing } = await admin
    .from("metrics_computed")
    .select("revenue, cost, orders")
    .eq("business_id", businessId)
    .eq("date", date)
    .maybeSingle();

  let finalRevenue;
  let finalOrders;
  let updatedMemo = null;

  if (revenueMode === "add") {
    const memo = { ...(integrationConfig?.quickbooks_revenue_memo || {}) };
    const prevContribution = Number(memo[date] || 0);
    const prevOrdersContribution = Number(memo[`${date}_orders`] || 0);
    const delta = Number((revenue - prevContribution).toFixed(2));
    finalRevenue = Number(((existing?.revenue || 0) + delta).toFixed(2));
    finalOrders = Math.max(0, (existing?.orders || 0) + orders - prevOrdersContribution);
    memo[date] = revenue;
    memo[`${date}_orders`] = orders;
    const cutoff = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    for (const key of Object.keys(memo)) {
      const keyDate = key.replace(/_orders$/, "");
      if (keyDate < cutoff) delete memo[key];
    }
    updatedMemo = memo;
  } else {
    finalRevenue = Number(revenue.toFixed(2));
    finalOrders = orders;
  }

  const cost = existing?.cost || 0;
  const marginPct = finalRevenue > 0 ? Number((((finalRevenue - cost) / finalRevenue) * 100).toFixed(1)) : 0;

  const { error } = await admin.from("metrics_computed").upsert(
    {
      business_id: businessId,
      date,
      revenue: finalRevenue,
      cost,
      margin_pct: marginPct,
      orders: finalOrders,
    },
    { onConflict: "business_id,date" }
  );
  if (error) {
    console.error(`Failed to write QuickBooks revenue for ${businessId} ${date}:`, error.message);
    return;
  }

  if (updatedMemo && integrationId) {
    const nextConfig = { ...(integrationConfig || {}), quickbooks_revenue_memo: updatedMemo };
    const { error: memoErr } = await admin.from("integrations").update({ config: nextConfig }).eq("id", integrationId);
    if (memoErr) console.error(`Failed to persist quickbooks_revenue_memo for integration ${integrationId}:`, memoErr.message);
    else integrationConfig.quickbooks_revenue_memo = updatedMemo;
  }
}

async function main(businessId, options = {}) {
  const sinceDaysOverride = options.sinceDays || null;

  let query = admin
    .from("integrations")
    .select("id, business_id, api_key_encrypted, config")
    .eq("provider", "quickbooks")
    .in("status", ["connected", "error"]);
  if (businessId) query = query.eq("business_id", businessId);
  const { data: integrations, error: fetchErr } = await query;

  if (fetchErr) {
    console.error("Failed to fetch quickbooks integrations:", fetchErr.message);
    await logError({ source: "quickbooks", message: "Failed to fetch quickbooks integrations list", details: fetchErr.message });
    return;
  }
  if (!integrations?.length) {
    console.log("No connected QuickBooks integrations, nothing to sync.");
    return;
  }

  const sinceDays = sinceDaysOverride || 2; // 48г, той самий стандартний зсув, що і в решти провайдерів
  const sinceDateStr = new Date(Date.now() - sinceDays * 24 * 3600 * 1000).toISOString().slice(0, 10);

  for (const integ of integrations) {
    try {
      const realmId = integ.config?.realm_id;
      if (!realmId) throw new Error("Missing realm_id in integration config");

      const secretPayload = JSON.parse(decrypt(integ.api_key_encrypted));
      if (!secretPayload?.refresh_token) throw new Error("Missing refresh_token in integration secret");

      // Рефрешимо ПЕРШИМ ділом і одразу зберігаємо новий refresh_token —
      // до будь-яких запитів до Query API. Якщо запис у БД впаде, все одно
      // продовжуємо цей прогін з отриманим access_token (лог нижче), але
      // ризикуємо застарілим refresh_token на наступному прогоні.
      const { accessToken, refreshToken: newRefreshToken } = await refreshAccessToken(secretPayload.refresh_token);
      const newEncrypted = encrypt(JSON.stringify({ refresh_token: newRefreshToken }));
      const { error: tokenSaveErr } = await admin
        .from("integrations")
        .update({ api_key_encrypted: newEncrypted })
        .eq("id", integ.id);
      if (tokenSaveErr) {
        console.error(`Failed to persist refreshed QuickBooks token for integration ${integ.id}:`, tokenSaveErr.message);
        await logError({ source: "quickbooks", message: "Failed to persist refreshed token", details: tokenSaveErr.message, businessId: integ.business_id });
      }

      const [payments, salesReceipts] = await Promise.all([
        queryEntities(accessToken, realmId, "Payment", sinceDateStr),
        queryEntities(accessToken, realmId, "SalesReceipt", sinceDateStr),
      ]);

      const byDate = {};
      for (const entity of [...payments, ...salesReceipts]) {
        const date = entity.TxnDate;
        const amount = Number(entity.TotalAmt);
        if (!date || !Number.isFinite(amount) || amount <= 0) continue;
        if (!byDate[date]) byDate[date] = { revenue: 0, orders: 0 };
        byDate[date].revenue += amount;
        byDate[date].orders += 1;
      }

      const revenueMode = integ.config?.revenue_mode === "add" ? "add" : "replace";
      for (const [date, agg] of Object.entries(byDate)) {
        await upsertQuickbooksRevenue({
          integrationId: integ.id,
          integrationConfig: integ.config || {},
          businessId: integ.business_id,
          date,
          revenue: Number(agg.revenue.toFixed(2)),
          orders: agg.orders,
          revenueMode,
        });
      }

      const { sync_error_reason: _prevError, ...cleanConfig } = integ.config || {};
      await admin
        .from("integrations")
        .update({ last_synced_at: new Date().toISOString(), status: "connected", config: cleanConfig })
        .eq("id", integ.id);

      console.log(`QuickBooks synced business ${integ.business_id}: ${Object.keys(byDate).length} day(s)`);
    } catch (err) {
      console.error(`Failed to sync QuickBooks integration ${integ.id}:`, err.message);
      await logError({
        source: "quickbooks",
        message: `Sync failed for integration ${integ.id}`,
        details: err.message,
        businessId: integ.business_id,
      });

      const reason = getSyncFailureReason(err);
      await admin
        .from("integrations")
        .update({ status: "error", config: { ...(integ.config || {}), sync_error_reason: reason } })
        .eq("id", integ.id);

      const contact = await getUserContact(await getBusinessUserId(integ.business_id));
      const msg = (SYNC_FAILURE_MESSAGE[contact.userLang] || SYNC_FAILURE_MESSAGE.EN)();
      const explanation = (SYNC_FAILURE_EXPLANATION[contact.userLang] || SYNC_FAILURE_EXPLANATION.EN)[reason];
      await sendAlertToBusiness(integ.business_id, contact, {
        type: "sync_failure_quickbooks",
        severity: "high",
        message: msg,
        aiExplanation: explanation,
      });
    }
  }
}

export async function runSync(businessId, options = {}) {
  await main(businessId, options);
  return { synced: true, timestamp: new Date().toISOString() };
}
