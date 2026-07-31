import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function checkAuth(req) {
  return req.headers.get("x-admin-secret") === process.env.ADMIN_SECRET;
}

export async function GET(req) {
  if (!checkAuth(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const [
    { data: users, error: usersErr },
    { data: businesses },
    { data: integrations },
    { data: subscriptions },
  ] = await Promise.all([
    admin.from("users").select("id, email, full_name, phone, telegram_id, is_blocked, created_at").order("created_at", { ascending: false }),
    admin.from("businesses").select("id, user_id"),
    admin.from("integrations").select("business_id, provider, status"),
    admin.from("subscriptions").select("user_id, plan, access_status"),
  ]);

  if (usersErr) return Response.json({ error: usersErr.message }, { status: 500 });

  const businessIdsByUser = new Map();
(businesses || []).forEach((b) => {
  const arr = businessIdsByUser.get(b.user_id) || [];
  arr.push(b.id);
  businessIdsByUser.set(b.user_id, arr);
});

const stripeConnectedBusinessIds = new Set(
  (integrations || [])
    .filter((i) => i.provider === "stripe" && i.status === "connected")
    .map((i) => i.business_id)
);

  const subByUser = new Map();
  (subscriptions || []).forEach((s) => subByUser.set(s.user_id, s));

  const result = (users || []).map((u) => {
    const userBusinessIds = businessIdsByUser.get(u.id) || [];
    const sub = subByUser.get(u.id);
    return {
      id: u.id,
      email: u.email,
      full_name: u.full_name,
      phone: u.phone,
      is_blocked: u.is_blocked,
      created_at: u.created_at,
      stripeConnected: userBusinessIds.some((id) => stripeConnectedBusinessIds.has(id)),
      telegramConnected: !!u.telegram_id,
      plan: sub?.plan || null,
      access_status: sub?.access_status || null,
    };
  });

  return Response.json({ users: result });
}

export async function PUT(req) {
  if (!checkAuth(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id, is_blocked } = await req.json();
  if (!id || typeof is_blocked !== "boolean") {
    return Response.json({ error: "invalid input" }, { status: 400 });
  }

  const { error } = await admin.from("users").update({ is_blocked }).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}