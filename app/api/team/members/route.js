// app/api/team/members/route.js
// GET   ?email=owner@x.com                 -> список активних учасників команди (з categories)
// PATCH { email, memberId, categories }    -> змінити категорії сповіщень учасника в будь-який момент
// DELETE { email, memberId }               -> відкликати доступ конкретного учасника

import { createClient } from "@supabase/supabase-js";
import { ALERT_CATEGORIES } from "@/lib/alerts.mjs";
import { requireUser, UnauthorizedError } from "@/lib/require-user";

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
  let email;
  try {
    ({ email } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }

  const businessId = await getBusinessId(email);
  if (!businessId) return Response.json({ members: [] });

  const { data: members } = await admin
    .from("team_members")
    .select("id, telegram_id, telegram_username, role, status, categories, created_at")
    .eq("business_id", businessId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  return Response.json({ members: members || [] });
}

// Дозволяє власнику будь-коли розширити або звузити доступ конкретному
// учаснику (наприклад, дати бухгалтеру ще й "inventory" пізніше), а не лише
// один раз зафіксувати категорії в момент видачі запрошення.
export async function PATCH(req) {
  const { memberId, categories } = await req.json();
  let email;
  try {
    ({ email } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }
  if (!memberId) return Response.json({ error: "missing fields" }, { status: 400 });
  if (!Array.isArray(categories) || categories.length === 0) {
    return Response.json({ error: "categories must be a non-empty array" }, { status: 400 });
  }
  const safeCategories = categories.filter((c) => ALERT_CATEGORIES.includes(c));
  if (!safeCategories.length) {
    return Response.json({ error: "no valid categories provided" }, { status: 400 });
  }

  const businessId = await getBusinessId(email);
  if (!businessId) return Response.json({ error: "not found" }, { status: 404 });

  const { error } = await admin
    .from("team_members")
    .update({ categories: safeCategories })
    .eq("id", memberId)
    .eq("business_id", businessId); // не даём изменить чужого участника подменой id

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, categories: safeCategories });
}

export async function DELETE(req) {
  const { memberId } = await req.json();
  let email;
  try {
    ({ email } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }
  if (!memberId) return Response.json({ error: "missing fields" }, { status: 400 });

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