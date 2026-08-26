import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin-auth";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function startOfDay(daysAgo = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

export async function GET(req) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  try {
    const [
      { count: totalUsers },
      { count: registeredToday },
      { count: registeredWeek },
      { count: totalBusinesses },
      { count: stripeConnected },
      { data: allUsers },
      { data: allSubs },
      { data: allEvents },
      { data: allInterest },
    ] = await Promise.all([
      admin.from("users").select("id", { count: "exact", head: true }),
      admin.from("users").select("id", { count: "exact", head: true }).gte("created_at", startOfDay(0)),
      admin.from("users").select("id", { count: "exact", head: true }).gte("created_at", startOfDay(7)),
      admin.from("businesses").select("id", { count: "exact", head: true }),
      admin.from("integrations").select("id", { count: "exact", head: true }).eq("provider", "stripe").eq("status", "connected"),
      admin.from("users").select("id, telegram_id"),
      admin.from("subscriptions").select("plan, access_status"),
      admin.from("user_events").select("event_type, channel, created_at"),
      admin.from("interest_signals").select("email, response, created_at"),
    ]);

    const telegramConnected = (allUsers || []).filter((u) => u.telegram_id).length;

    // "Завершили онбординг" = подключили хотя бы одну интеграцию (Stripe ИЛИ Telegram)
    const { data: stripeBusinessIds } = await admin
      .from("integrations")
      .select("business_id")
      .eq("provider", "stripe")
      .eq("status", "connected");

    const { data: businessesWithUsers } = await admin
      .from("businesses")
      .select("id, user_id");

    const stripeUserIds = new Set(
      (stripeBusinessIds || [])
        .map((i) => businessesWithUsers?.find((b) => b.id === i.business_id)?.user_id)
        .filter(Boolean)
    );
    const telegramUserIds = new Set((allUsers || []).filter((u) => u.telegram_id).map((u) => u.id));
    const onboardedUserIds = new Set([...stripeUserIds, ...telegramUserIds]);

    const planCounts = { trial: 0, starter: 0, growth: 0, scale: 0, blocked: 0, none: 0 };
    (allSubs || []).forEach((s) => {
      const key = s.plan && planCounts.hasOwnProperty(s.plan) ? s.plan : "none";
      planCounts[key]++;
    });

    const paidCount = planCounts.starter + planCounts.growth + planCounts.scale;

    const promptsSent = (allEvents || []).filter((e) => e.event_type === "trial_prompt_sent").length;
    const promptsYes = (allEvents || []).filter((e) => e.event_type === "trial_prompt_yes").length;
    const promptsNo = (allEvents || []).filter((e) => e.event_type === "trial_prompt_no").length;

    const telegramClicks = (allEvents || []).filter((e) => e.channel === "telegram").length;
    const webEvents = (allEvents || []).filter((e) => e.channel === "web").length;

    const interestYes = (allInterest || []).filter((i) => i.response === "yes").length;
    const interestNotNow = (allInterest || []).filter((i) => i.response === "not_now").length;

    return Response.json({
      totalUsers: totalUsers || 0,
      registeredToday: registeredToday || 0,
      registeredWeek: registeredWeek || 0,
      totalBusinesses: totalBusinesses || 0,
      stripeConnected: stripeConnected || 0,
      telegramConnected,
      onboardedCount: onboardedUserIds.size,
      planCounts,
      paidCount,
      funnel: {
        registered: totalUsers || 0,
        createdBusiness: totalBusinesses || 0,
        onboarded: onboardedUserIds.size,
        paid: paidCount,
      },
      trialEngagement: {
        promptsSent,
        promptsYes,
        promptsNo,
        interestYes,
        interestNotNow,
      },
      activityByChannel: {
        telegram: telegramClicks,
        web: webEvents,
      },
    });
  } catch (err) {
    console.error("analytics error:", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
