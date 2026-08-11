// app/api/team/members/route.js
// GET  ?email=owner@x.com          -> список активних учасників команди
// DELETE { email, memberId }        -> відкликати доступ конкретного учасника

import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function getBusinessId(email) {
  const { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!appUser) return null;
  // .order("created_at", { ascending: true }) — той самий фікс, що і в
  // /api/business-profile: без нього при кількох рядках businesses на
  // одного user_id (гонка паралельних перших завантажень) вибиралась
  // випадкова строка, і команда бачила не той business_id, що на дашборді.
  const { data: business } = await admin
    .from("businesses")
    .select("id")
    .eq("user_id", appUser.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return business?.id || null;
}

export async function GET(req) {
  const email = new URL(req.url).searchParams.get("email");
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const businessId = await getBusinessId(email);
  if (!businessId) return Response.json({ members: [] });

  const { data: members } = await admin
    .from("team_members")
    .select("id, telegram_id, telegram_username, role, status, created_at")
    .eq("business_id", businessId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  return Response.json({ members: members || [] });
}

export async function DELETE(req) {
  const { email, memberId } = await req.json();
  if (!email || !memberId) return Response.json({ error: "missing fields" }, { status: 400 });

  const businessId = await getBusinessId(email);
  if (!businessId) return Response.json({ error: "not found" }, { status: 404 });

  const { error } = await admin
    .from("team_members")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", memberId)
    .eq("business_id", businessId); // не даём отозвать чужого участника подменой id

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
