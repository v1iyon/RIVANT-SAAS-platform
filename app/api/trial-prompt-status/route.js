// app/api/trial-prompt-status/route.js
import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export async function GET(req) {
  const email = new URL(req.url).searchParams.get("email");
  if (!email) return Response.json({ shouldShow: false });

  const { data: user } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!user) return Response.json({ shouldShow: false });

  const { data: sub } = await admin
    .from("subscriptions")
    .select("plan, current_period_end")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!sub || sub.plan !== "trial" || !sub.current_period_end) return Response.json({ shouldShow: false });

  const daysLeft = (new Date(sub.current_period_end).getTime() - Date.now()) / (24 * 3600 * 1000);
  if (daysLeft > 3 || daysLeft < 0) return Response.json({ shouldShow: false });

  const { data: existing } = await admin
    .from("user_events")
    .select("id")
    .eq("user_id", user.id)
    .in("event_type", ["trial_prompt_yes", "trial_prompt_no"])
    .maybeSingle();

  return Response.json({ shouldShow: !existing });
}