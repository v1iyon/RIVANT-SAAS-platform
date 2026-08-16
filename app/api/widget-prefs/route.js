import { createClient } from "@supabase/supabase-js";
import { requireUser, UnauthorizedError } from "@/lib/require-user";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const KNOWN_WIDGET_IDS = ["revenue", "profit", "margin", "cac", "orders", "aov", "expenses"];
const DEFAULT_WIDGET_IDS = ["revenue", "profit", "margin", "cac"];
const WIDGET_LIMIT = 4;

export async function GET(req) {
  let email;
  try {
    ({ email } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }

  const { data: user } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!user) return Response.json({ widgetIds: DEFAULT_WIDGET_IDS });

  const { data: row } = await admin
    .from("user_widget_prefs")
    .select("widget_ids")
    .eq("user_id", user.id)
    .maybeSingle();

  const ids = row?.widget_ids;
  const valid =
    Array.isArray(ids) &&
    ids.length === WIDGET_LIMIT &&
    new Set(ids).size === WIDGET_LIMIT &&
    ids.every((id) => KNOWN_WIDGET_IDS.includes(id));

  return Response.json({ widgetIds: valid ? ids : DEFAULT_WIDGET_IDS });
}

export async function PUT(req) {
  const { widgetIds } = await req.json();
  let email;
  try {
    ({ email } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }

  const valid =
    Array.isArray(widgetIds) &&
    widgetIds.length === WIDGET_LIMIT &&
    new Set(widgetIds).size === WIDGET_LIMIT &&
    widgetIds.every((id) => KNOWN_WIDGET_IDS.includes(id));

  if (!valid) {
    return Response.json({ error: `widgetIds must be exactly ${WIDGET_LIMIT} unique known widgets` }, { status: 400 });
  }

  const { data: user } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!user) return Response.json({ error: "user not found" }, { status: 404 });

  const { error } = await admin
    .from("user_widget_prefs")
    .upsert({ user_id: user.id, widget_ids: widgetIds, updated_at: new Date().toISOString() }, { onConflict: "user_id" });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}