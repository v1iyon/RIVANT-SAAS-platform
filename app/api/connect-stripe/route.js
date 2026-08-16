import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { requireUser, UnauthorizedError } from "@/lib/require-user";

export const runtime = "nodejs";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function getKey() {
  return crypto.createHash("sha256").update(process.env.ENCRYPTION_KEY || "").digest();
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

async function verifyStripeKey(apiKey) {
  const res = await fetch("https://api.stripe.com/v1/charges?limit=1", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return res.ok;
}

export async function POST(req) {
  try {
    const { apiKey } = await req.json();
    const { email } = await requireUser();

    if (!apiKey) {
      return Response.json({ error: "API key is required" }, { status: 400 });
    }

    if (!apiKey.startsWith("rk_")) {
      return Response.json(
        { error: "Please use a restricted key (starts with rk_test_ or rk_live_), not a full secret key" },
        { status: 400 }
      );
    }

    const isValid = await verifyStripeKey(apiKey);
    if (!isValid) {
      return Response.json(
        { error: "Stripe rejected this key. Check it has 'Charges: Read' permission and is not expired." },
        { status: 400 }
      );
    }

    const { data: user } = await admin
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (!user) {
      return Response.json({ error: "Account not found" }, { status: 404 });
    }

    const { data: business } = await admin
      .from("businesses")
      .select("id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!business) {
      return Response.json(
        { error: "Complete your business profile first (Settings → Company Name)" },
        { status: 400 }
      );
    }

    const encrypted = encrypt(apiKey);
    const keyPreview = apiKey.slice(0, 12) + "..." + apiKey.slice(-4);

    const { data: existing } = await admin
      .from("integrations")
      .select("id")
      .eq("business_id", business.id)
      .eq("provider", "stripe")
      .maybeSingle();

    if (existing) {
      await admin
        .from("integrations")
        .update({ api_key_encrypted: encrypted, status: "connected", key_preview: keyPreview, config: { backfill_pending: true } })
        .eq("id", existing.id);
    } else {
      await admin.from("integrations").insert({
        business_id: business.id,
        provider: "stripe",
        api_key_encrypted: encrypted,
        status: "connected",
        key_preview: keyPreview,
        config: { backfill_pending: true },
      });
    }

    return Response.json({ success: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) return Response.json({ error: "unauthorized" }, { status: 401 });
    console.error("connect-stripe error:", err);
    return Response.json({ error: "Server error, try again" }, { status: 500 });
  }
}