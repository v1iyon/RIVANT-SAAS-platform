import { createClient } from "@supabase/supabase-js";
import { requireUser, UnauthorizedError } from "@/lib/require-user";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function GET(req) {
  let email;
  try {
    ({ email } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }

  const { data: user } = await admin
    .from("users")
    .select("last_seen_broadcast_at")
    .eq("email", email)
    .maybeSingle();

  const { data: latest } = await admin
  .from("broadcast_notifications")
  .select("id, message, created_at, expires_at")
  .eq("sent_inapp", true)
  .or(`expires_at.is.null,expires_at.gte.${new Date().toISOString()}`)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

  if (!latest) return Response.json({ notification: null });

  const alreadySeen =
    user?.last_seen_broadcast_at &&
    new Date(user.last_seen_broadcast_at) >= new Date(latest.created_at);

  return Response.json({ notification: alreadySeen ? null : latest });
}

export async function POST(req) {
  let email;
  try {
    ({ email } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }

  await admin
    .from("users")
    .update({ last_seen_broadcast_at: new Date().toISOString() })
    .eq("email", email);

  return Response.json({ success: true });
}