import { createClient } from "@supabase/supabase-js";
import { requireUser, UnauthorizedError } from "@/lib/require-user";
import { decrypt } from "@/lib/crypto";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function POST(req) {
  try {
    const { email } = await requireUser();

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

    // ФІКС (аудит #2, знахідка №9, прибирання за собою): якщо при
    // підключенні був зареєстрований webhook endpoint у Stripe клієнта
    // (lib/stripe-webhook.mjs), видаляємо його тут — інакше в акаунті
    // клієнта лишається "мертвий" ендпоінт, який продовжує слати запити на
    // business_id, що для нас більше нічого не означає. Best-effort: ключ
    // міг вже бути відкликаний клієнтом вручну в Stripe — тоді видалення
    // просто не вдасться, і це не повинно блокувати сам disconnect.
    const { data: integ } = await admin
      .from("integrations")
      .select("api_key_encrypted, config")
      .eq("business_id", business.id)
      .eq("provider", "stripe")
      .maybeSingle();

    if (integ?.api_key_encrypted && integ?.config?.webhook_id) {
      try {
        const { deleteStripeWebhook } = await import("../../../lib/stripe-webhook.mjs");
        await deleteStripeWebhook(decrypt(integ.api_key_encrypted), integ.config.webhook_id);
      } catch (err) {
        console.error("stripe-disconnect: failed to clean up webhook endpoint:", err.message);
      }
    }

    await admin
      .from("integrations")
      .update({ status: "disconnected", api_key_encrypted: null })
      .eq("business_id", business.id)
      .eq("provider", "stripe");

    // ФІКС (обговорення 30.08.2026): раніше при disconnect алерти, пов'язані
    // з цим провайдером (sync_failure_stripe, revenue_drop, payment_silence_stripe),
    // лишались зі status "open" НАЗАВЖДИ — жоден роут ніколи їх не резолвив,
    // окрім повного видалення акаунта. Клієнт, який давно відключив Stripe,
    // продовжував бачити "N alert(s) open" у щоденних звітах і на вкладці
    // Risks — про джерело даних, якого вже нема.
    await admin
      .from("alerts_log")
      .update({ status: "resolved" })
      .eq("business_id", business.id)
      .eq("status", "open")
      .in("type", ["sync_failure_stripe", "revenue_drop", "payment_silence_stripe"]);

    return Response.json({ success: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    console.error("stripe-disconnect error:", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}