// app/api/integrations-select/route.js
import { createClient } from "@supabase/supabase-js";
import { requireUser, UnauthorizedError } from "@/lib/require-user";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Growth — 1 доп. интеграция сверх Stripe, Scale — все сразу без выбора.
const SELECTABLE_PROVIDERS = ["meta_ads", "google_ads", "shopify", "quickbooks", "google_analytics"];

export async function GET(req) {
  let email;
  try {
    ({ email } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }

  const { data: user } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!user) return Response.json({ selected: [], locked: false });

  const { data: sub } = await admin
    .from("subscriptions")
    .select("plan, integrations_selected, current_period_end")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!sub) return Response.json({ selected: [], locked: false });

  const periodActive = sub.current_period_end ? new Date(sub.current_period_end) > new Date() : false;
  const selected = sub.integrations_selected || [];

  return Response.json({
    selected,
    // Заблокировано менять выбор, если план Growth (не Scale), выбор уже не пуст
    // и текущий billing-период ещё не закончился.
    locked: sub.plan === "growth" && selected.length > 0 && periodActive,
    plan: sub.plan,
  });
}

export async function POST(req) {
  try {
    const { providers } = await req.json();
    const { email } = await requireUser();
    if (!Array.isArray(providers)) {
      return Response.json({ error: "providers[] is required" }, { status: 400 });
    }
    if (providers.some((p) => !SELECTABLE_PROVIDERS.includes(p))) {
      return Response.json({ error: "Unknown provider in selection" }, { status: 400 });
    }

    const { data: user } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    if (!user) return Response.json({ error: "User not found" }, { status: 404 });

    const { data: sub } = await admin
      .from("subscriptions")
      .select("plan, integrations_selected, current_period_end")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!sub) return Response.json({ error: "No active subscription" }, { status: 400 });

    const periodActive = sub.current_period_end ? new Date(sub.current_period_end) > new Date() : false;
    const alreadyLocked = sub.plan === "growth" && (sub.integrations_selected || []).length > 0 && periodActive;
    if (alreadyLocked) {
      return Response.json(
        { error: "Selection is locked until your current billing period ends or you upgrade your plan" },
        { status: 403 }
      );
    }

    // Growth — максимум 1 доп. интеграция сверх Stripe, Scale и Trial — без
    // ограничения по количеству (триал должен реально давать попробовать всё,
    // иначе плашка "усі інтеграції безкоштовно" на лендинге была бы неправдой).
    if (sub.plan === "growth" && providers.length > 1) {
      return Response.json({ error: "Growth plan allows only 1 additional integration" }, { status: 400 });
    }
    if (sub.plan !== "growth" && sub.plan !== "scale" && sub.plan !== "trial") {
      return Response.json({ error: "Additional integrations require an active plan" }, { status: 403 });
    }

    await admin.from("subscriptions").update({ integrations_selected: providers }).eq("user_id", user.id);

    return Response.json({ success: true, selected: providers });
  } catch (err) {
    if (err instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    console.error("integrations-select error:", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}