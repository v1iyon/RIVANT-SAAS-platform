// app/api/integration-revenue-mode/route.js
//
// Раніше єдиний спосіб змінити config.revenue_mode для вже підключеного
// Shopify — відключити інтеграцію і підключити знову (з чекбоксом), заново
// вводячи Client ID/Secret. Це рідкісна дія (по суті, one-time рішення "чи
// Shopify Checkout = той самий Stripe" чи "окремий потік грошей"), тож не
// вимагає повного connect-integration флоу — просто patch одного поля в
// config без торкання api_key_encrypted/status.
import { createClient } from "@supabase/supabase-js";
import { requireUser, UnauthorizedError } from "@/lib/require-user";
import { downgradeConflictingReplaceProviders } from "@/lib/revenue-mode";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Актуально для Shopify та WooCommerce — обидва можуть дублювати виручку,
// вже пораховану Stripe (магазин на власному Stripe/WooCommerce Payments
// checkout). Список навмисно явний, а не "будь-який provider", щоб endpoint
// не можна було мовчки застосувати там, де revenue_mode нічого не означає.
const SUPPORTED_PROVIDERS = ["shopify", "woocommerce"];

export async function PATCH(req) {
  try {
    const { provider, revenueMode } = await req.json();
    const { email } = await requireUser();
    if (!provider) {
      return Response.json({ error: "provider is required" }, { status: 400 });
    }
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
      return Response.json({ error: "revenue_mode is not applicable to this provider" }, { status: 400 });
    }
    if (revenueMode !== "add" && revenueMode !== "replace") {
      return Response.json({ error: "revenueMode must be 'add' or 'replace'" }, { status: 400 });
    }

    const { data: user } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    if (!user) return Response.json({ error: "not found" }, { status: 404 });

    const { data: business } = await admin
      .from("businesses")
      .select("id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!business) return Response.json({ error: "not found" }, { status: 404 });

    const { data: integration } = await admin
      .from("integrations")
      .select("id, config")
      .eq("business_id", business.id)
      .eq("provider", provider)
      .maybeSingle();
    if (!integration) return Response.json({ error: "integration not connected" }, { status: 404 });

    // ФІКС (задвоєння/тиха втрата доходу): "replace" може бути щонайбільше
    // в одного з REPLACE_TOGGLE_PROVIDERS одночасно — інакше цей провайдер
    // і, скажімо, вже-replace WooCommerce почнуть по черзі перезаписувати
    // один одного в metrics_computed при кожному прогоні синку (див.
    // lib/revenue-mode.js). Перед власне зміною режиму понижуємо будь-якого
    // конфліктуючого сусіда до "add" — і повертаємо, кого саме понизили,
    // щоб фронтенд explicitly пояснив користувачу, що сталось, а не тихо
    // змінив поведінку іншої картки в фоні.
    const downgraded = await downgradeConflictingReplaceProviders(admin, business.id, provider, revenueMode);

    const nextConfig = { ...(integration.config || {}), revenue_mode: revenueMode };
    const { error: updateErr } = await admin
      .from("integrations")
      .update({ config: nextConfig })
      .eq("id", integration.id);
    if (updateErr) return Response.json({ error: `Database error: ${updateErr.message}` }, { status: 500 });

    return Response.json({ success: true, revenueMode, downgraded });
  } catch (err) {
    if (err instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    console.error("integration-revenue-mode error:", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}