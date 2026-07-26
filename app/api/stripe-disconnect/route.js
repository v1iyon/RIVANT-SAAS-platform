import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function POST(req) {
  try {
    const { email } = await req.json();
    if (!email) return Response.json({ error: "email required" }, { status: 400 });

    const { data: user } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    if (!user) return Response.json({ error: "not found" }, { status: 404 });

    const { data: business } = await admin
      .from("businesses")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!business) return Response.json({ error: "not found" }, { status: 404 });

    await admin
      .from("integrations")
      .update({ status: "disconnected", api_key_encrypted: null })
      .eq("business_id", business.id)
      .eq("provider", "stripe");

    return Response.json({ success: true });
  } catch (err) {
    console.error("stripe-disconnect error:", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}