// app/api/sync-now/route.js
//
// Ручной триггер синка для ОДНОГО бизнеса. Раньше данные появлялись только
// после часового GitHub Actions cron — пользователь подключал Stripe и не
// понимал, почему на дашборде всё ещё нули (это не баг, просто нужно было
// подождать). Теперь после подключения фронт сразу дёргает этот роут.
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export async function POST(req) {
  try {
    const { email, provider } = await req.json();
    if (!email) return Response.json({ error: "email required" }, { status: 400 });

    const { data: user } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    if (!user) return Response.json({ error: "not found" }, { status: 404 });

    const { data: business } = await admin
      .from("businesses")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!business) return Response.json({ error: "not found" }, { status: 404 });

    // Без provider — синкаем все три источника для этого бизнеса, каждый
    // независимо (ошибка одного не должна блокировать другие).
    const jobs = [];
    if (!provider || provider === "stripe") {
      jobs.push(import("../../../scripts/sync-stripe-core.mjs").then((m) => m.runSync(business.id)));
    }
    if (!provider || provider === "shopify") {
      jobs.push(import("../../../scripts/shopify-sync.mjs").then((m) => m.runSync(business.id)));
    }
    if (!provider || provider === "meta_ads") {
      jobs.push(import("../../../scripts/meta-ads-sync.mjs").then((m) => m.runSync(business.id)));
    }

    const results = await Promise.allSettled(jobs);
    const failures = results.filter((r) => r.status === "rejected");

    return Response.json({
      success: true,
      synced: results.length - failures.length,
      failed: failures.length,
    });
  } catch (err) {
    console.error("sync-now error:", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}