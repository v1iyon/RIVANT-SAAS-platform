// app/api/integrations-status/route.js
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Провайдеры, которыми управляет этот генерик-роут (Stripe остаётся на своих
// отдельных /api/connect-stripe и /api/stripe-disconnect — не трогаем).
const SUPPORTED_PROVIDERS = ["meta_ads", "google_ads", "shopify", "quickbooks", "google_analytics"];

export async function GET(req) {
  const email = new URL(req.url).searchParams.get("email");
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!appUser) return Response.json({ integrations: [] });

  const { data: business } = await admin
    .from("businesses")
    .select("id")
    .eq("user_id", appUser.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!business) return Response.json({ integrations: [] });

  const { data: rows } = await admin
    .from("integrations")
    .select("provider, status, last_synced_at, key_preview, config")
    .eq("business_id", business.id)
    .in("provider", SUPPORTED_PROVIDERS);

  // Возвращаем запись для каждого провайдера из списка, даже если ещё не подключён —
  // чтобы в UI строка отрисовалась сразу с корректным "не подключено" состоянием.
  const integrations = SUPPORTED_PROVIDERS.map((provider) => {
    const row = rows?.find((r) => r.provider === provider);
    // "error" означает, что ключи вже збережені і раніше все підключалось —
    // просто останній синк не пройшов (протух токен, змінені права і т.д.).
    // Раніше ми показували таку інтеграцію як "не підключено" і UI стирав
    // вже введені Client ID/Secret/домен, змушуючи вводити все заново навіть
    // якщо користувачу просто треба почекати наступний синк або натиснути
    // "Підключити" ще раз без жодних змін. Тепер лишаємо картку в стані
    // "підключено", але передаємо прапорець sync_error, щоб UI показав
    // попередження замість порожньої форми.
    const connected = row?.status === "connected" || row?.status === "error";
    return {
      provider,
      connected,
      sync_error: row?.status === "error",
      last_synced_at: row?.last_synced_at || null,
      key_preview: row?.key_preview || null,
      config: row?.config || {},
    };
  });

  return Response.json({ integrations });
}