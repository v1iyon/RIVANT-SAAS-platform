import { createClient } from "@supabase/supabase-js";
import { requireUser, UnauthorizedError } from "@/lib/require-user";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function POST(req) {
  let email;
  try {
    ({ email } = await requireUser());
  } catch (e) {
    if (e instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }

  const { error } = await admin.from("users").update({ telegram_id: null }).eq("email", email);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}