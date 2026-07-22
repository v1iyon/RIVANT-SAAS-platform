// app/api/metrics/route.ts
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function GET(req: Request) {
  const email = new URL(req.url).searchParams.get("email");
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const { data: appUser } = await admin.from("users").select("id").eq("email", email).maybeSingle();
  if (!appUser) return Response.json({ hasData: false, rows: [] });

  const { data: business } = await admin
    .from("businesses")
    .select("id")
    .eq("user_id", appUser.id)
    .maybeSingle();
  if (!business) return Response.json({ hasData: false, rows: [] });

  const { data: rows, error } = await admin
    .from("metrics_computed")
    .select("date, revenue, expenses, profit, cac")
    .eq("business_id", business.id)
    .order("date", { ascending: true })
    .limit(90);

  if (error || !rows || rows.length === 0) {
    return Response.json({ hasData: false, rows: [] });
  }

  return Response.json({ hasData: true, rows });
}