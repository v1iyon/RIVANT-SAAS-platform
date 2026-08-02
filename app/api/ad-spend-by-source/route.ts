// app/api/ad-spend-by-source/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: Request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email");
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("email", email)
    .single();

  if (!business) return NextResponse.json({ google: 0, meta: 0, googlePrev: 0, metaPrev: 0 });

  const now = new Date();
  const periodStart = new Date(now); periodStart.setDate(now.getDate() - 30);
  const prevPeriodStart = new Date(now); prevPeriodStart.setDate(now.getDate() - 60);

  const { data: expenses } = await supabase
    .from("expenses")
    .select("source, amount, date")
    .eq("business_id", business.id)
    .gte("date", prevPeriodStart.toISOString())
    .in("source", ["google_ads", "meta_ads"]);

  let google = 0, meta = 0, googlePrev = 0, metaPrev = 0;
  for (const e of expenses || []) {
    const d = new Date(e.date);
    const inCurrent = d >= periodStart;
    if (e.source === "google_ads") {
      inCurrent ? (google += e.amount) : (googlePrev += e.amount);
    } else if (e.source === "meta_ads") {
      inCurrent ? (meta += e.amount) : (metaPrev += e.amount);
    }
  }

  return NextResponse.json({ google, meta, googlePrev, metaPrev });
}