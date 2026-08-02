import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
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

  // ⚠️ ПРОВЕРЬ: названия колонок (business_id / source / amount / date)
  // должны совпадать с тем, что реально пишут meta-ads-sync.mjs и google-ads sync
  // в таблицу expenses. Значения source, скорее всего, "meta_ads" и "google_ads" —
  // это те же строки, что уже используются как provider в IntegrationConnectCard.
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