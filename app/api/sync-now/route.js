// app/api/sync-now/route.js
//
// Ручной триггер синка для ОДНОГО бизнеса. Раньше данные появлялись только
// после часового GitHub Actions cron — пользователь подключал Stripe и не
// понимал, почему на дашборде всё ещё нули (это не баг, просто нужно было
// подождать). Теперь после подключения фронт сразу дёргает этот роут.
import { createClient } from "@supabase/supabase-js";
import { getPrimaryBusinessId } from "@/lib/get-primary-business";
import { requireUser, UnauthorizedError } from "@/lib/require-user";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export async function POST(req) {
  try {
    const { provider } = await req.json();
    const { email } = await requireUser();

    const { data: user } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    if (!user) return Response.json({ error: "not found" }, { status: 404 });

    const businessId = await getPrimaryBusinessId(admin, user.id);
    if (!businessId) return Response.json({ error: "not found" }, { status: 404 });

    // Без provider — синкаем все три источника для этого бизнеса, каждый
    // независимо (ошибка одного не должна блокировать другие).
    const jobs = [];
    if (!provider || provider === "stripe") {
      jobs.push(import("../../../scripts/sync-stripe-core.mjs").then((m) => m.runSync(businessId)));
    }
    if (!provider || provider === "shopify") {
      jobs.push(import("../../../scripts/shopify-sync.mjs").then((m) => m.runSync(businessId)));
    }
    if (!provider || provider === "meta_ads") {
      jobs.push(import("../../../scripts/meta-ads-sync.mjs").then((m) => m.runSync(businessId)));
    }
    if (!provider || provider === "google_ads") {
      jobs.push(import("../../../scripts/google-ads-sync.mjs").then((m) => m.runSync(businessId)));
    }

    const results = await Promise.allSettled(jobs);
    const failures = results.filter((r) => r.status === "rejected");
    const attemptedProviders = provider ? [provider] : ["stripe", "shopify", "meta_ads", "google_ads"];
    // Sync-модули не прерывают остальные интеграции при ошибке, поэтому они
    // фиксируют её в integrations.status. Считываем результат после прогона,
    // чтобы интерфейс мог показать временное сообщение именно для неудавшейся
    // ручной синхронизации.
    const { data: integrations } = await admin
      .from("integrations")
      .select("provider, status")
      .eq("business_id", businessId)
      .in("provider", attemptedProviders);
    const failedProviders = (integrations || [])
      .filter((integration) => integration.status === "error")
      .map((integration) => integration.provider);

    return Response.json({
      success: failures.length === 0 && failedProviders.length === 0,
      synced: results.length - failures.length,
      failed: failures.length + failedProviders.length,
      failedProviders,
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    console.error("sync-now error:", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}