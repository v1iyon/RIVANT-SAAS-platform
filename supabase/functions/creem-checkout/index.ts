// supabase/functions/creem-checkout/index.ts
//
// Заменяет статические Ko-fi Shop Item ссылки (DEFAULT_KOFI_LINKS в
// PaymentModal.tsx / ADDON_CATALOG[...].kofiLink в pricing-section.tsx).
// Вызывается фронтендом при клике "Pay" — резолвит цену/продукт СЕРВЕРНО
// (клиент только присылает, ЧТО он выбрал: plan_id, или addon_kind+slug),
// создаёт checkout session в Creem через POST /v1/checkouts и возвращает
// готовый checkout_url для попапа. Один checkout session = один продукт —
// в отличие от Ko-fi здесь нет персистентной невидимой корзины, поэтому
// весь класс багов, которым была посвящена половина kofi-webhook (v2:
// "shop_items может содержать несколько разных тарифов/допуслуг в одном
// чеке"), для Creem просто не существует по конструкции.
//
// Auth-паттерн скопирован 1-в-1 из create-order/index.ts (JWT в
// Authorization: Bearer, резолв public.users.id по auth_user_id с
// фоллбэком на email) — тот же контракт, тот же клиент (см.
// lib/creem-checkout.ts, аналог lib/crypto-checkout.ts).
//
// Deploy:
//   supabase functions deploy creem-checkout --no-verify-jwt
//
// Env (нужно установить):
//   supabase secrets set CREEM_API_KEY=creem_xxx
//   supabase secrets set CREEM_MODE=test        # или "live"
//   supabase secrets set CREEM_PRODUCT_STARTER=prod_xxx
//   supabase secrets set CREEM_PRODUCT_GROWTH=prod_xxx
//   supabase secrets set CREEM_PRODUCT_SCALE=prod_xxx
//   supabase secrets set CREEM_PRODUCT_WHATIF_ANALYSIS=prod_xxx
//   supabase secrets set CREEM_PRODUCT_MONTHLY_DIGEST=prod_xxx
//   supabase secrets set CREEM_PRODUCT_TEAM_ALERTS=prod_xxx
//
// Product ID'ы берутся из Creem Dashboard -> Products -> (товар) ->
// "Copy ID". По одному продукту на тариф/допуслугу, как раньше было по
// одной Ko-fi Shop Item ссылке.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CREEM_API_KEY = Deno.env.get("CREEM_API_KEY")!;
const CREEM_MODE = Deno.env.get("CREEM_MODE") === "live" ? "live" : "test";
const CREEM_API_BASE = CREEM_MODE === "live" ? "https://api.creem.io" : "https://test-api.creem.io";
const ALLOWED_ORIGIN = Deno.env.get("SITE_URL") || "https://rivant-os.com";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// --- Тарифы: plan_id -> Creem product_id ------------------------------
const PLAN_TO_CREEM_PRODUCT: Record<string, string | undefined> = {
  starter: Deno.env.get("CREEM_PRODUCT_STARTER"),
  growth: Deno.env.get("CREEM_PRODUCT_GROWTH"),
  scale: Deno.env.get("CREEM_PRODUCT_SCALE"),
};

// --- Допуслуги: addon_slug -> { product_id, kind } ---------------------
// kind здесь — источник правды (как addon_kind в create-order's
// ADDON_CATALOG) — то, что клиент прислал, только выбирает slug.
const ADDON_TO_CREEM: Record<string, { productIdEnv: string; kind: "order" | "subscription" }> = {
  whatif_analysis: { productIdEnv: "CREEM_PRODUCT_WHATIF_ANALYSIS", kind: "order" },
  monthly_digest: { productIdEnv: "CREEM_PRODUCT_MONTHLY_DIGEST", kind: "subscription" },
  team_alerts: { productIdEnv: "CREEM_PRODUCT_TEAM_ALERTS", kind: "subscription" },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "not_authenticated" }, 401);

    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(jwt);
    if (authError || !authData?.user) return json({ error: "invalid_session" }, 401);

    const authUser = authData.user;
    if (!authUser.email) return json({ error: "no_email_on_account" }, 400);

    const body = await req.json();
    const kind: "plan" | "addon" = body.kind === "addon" ? "addon" : "plan";

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    let { data: profile, error: profileError } = await admin
      .from("users")
      .select("id")
      .eq("auth_user_id", authUser.id)
      .maybeSingle();

    if (!profile && authUser.email) {
      const fallback = await admin.from("users").select("id").eq("email", authUser.email).maybeSingle();
      profile = fallback.data;
      profileError = fallback.error;
    }
    if (profileError) throw profileError;
    if (!profile) return json({ error: "profile_not_ready" }, 409);

    const userId = profile.id as string;

    let productId: string | undefined;
    let metadata: Record<string, string> = { user_id: userId, kind };

    if (kind === "plan") {
      const planId = body.plan_id;
      if (!planId || typeof planId !== "string" || !PLAN_TO_CREEM_PRODUCT[planId]) {
        return json({ error: "invalid_plan" }, 400);
      }

      // Сверяемся с public.plans, как и create-order — is_active гейт
      // должен работать одинаково для обоих способов оплаты.
      const { data: plan, error: planError } = await admin
        .from("plans")
        .select("id, is_active")
        .eq("id", planId)
        .maybeSingle();
      if (planError) throw planError;
      if (!plan || !plan.is_active) return json({ error: "invalid_plan" }, 400);

      productId = PLAN_TO_CREEM_PRODUCT[planId];
      metadata.plan_id = planId;
    } else {
      const addonSlug = body.addon_slug;
      if (!addonSlug || typeof addonSlug !== "string" || !ADDON_TO_CREEM[addonSlug]) {
        return json({ error: "invalid_addon" }, 400);
      }

      const catalogEntry = ADDON_TO_CREEM[addonSlug];
      productId = Deno.env.get(catalogEntry.productIdEnv);
      metadata.addon_slug = addonSlug;
      metadata.addon_kind = catalogEntry.kind;

      // business_id резолвим здесь же (не доверяем клиенту) — тот же
      // паттерн, что уже применён в AddonCheckoutModal.tsx/creem-webhook:
      // ровно один business на пользователя ожидается на этом этапе продукта.
      const { data: businesses, error: businessesError } = await admin
        .from("businesses")
        .select("id")
        .eq("user_id", userId);
      if (businessesError) throw businessesError;
      if (!businesses || businesses.length !== 1) {
        return json({ error: "ambiguous_business" }, 409);
      }
      metadata.business_id = businesses[0].id as string;
    }

    if (!productId) {
      console.error(`creem-checkout: missing product id env for ${kind}`, body);
      return json({ error: "payment_misconfigured" }, 500);
    }

    const creemRes = await fetch(`${CREEM_API_BASE}/v1/checkouts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CREEM_API_KEY,
      },
      body: JSON.stringify({
        product_id: productId,
        request_id: crypto.randomUUID(),
        customer: { email: authUser.email },
        success_url: `${ALLOWED_ORIGIN}/dashboard?payment=success`,
        metadata,
      }),
    });

    if (!creemRes.ok) {
      const errBody = await creemRes.text().catch(() => "");
      console.error("creem-checkout: Creem API error", creemRes.status, errBody);
      return json({ error: "checkout_creation_failed" }, 502);
    }

    const checkout = await creemRes.json();
    if (!checkout.checkout_url) {
      console.error("creem-checkout: Creem response missing checkout_url", checkout);
      return json({ error: "checkout_creation_failed" }, 502);
    }

    return json({ checkout_url: checkout.checkout_url });
  } catch (err) {
    console.error("creem-checkout error", err);
    return json({ error: "internal_error" }, 500);
  }
});