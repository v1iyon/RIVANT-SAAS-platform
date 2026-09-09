"use client";

// Calls the creem-checkout Edge Function and returns a checkout_url to
// open in a popup — same shape/contract as lib/crypto-checkout.ts's
// createCryptoOrder, so PaymentModal.tsx/AddonCheckoutModal.tsx can reuse
// the same "loading -> open -> wait" pattern for both payment methods.
//
// Replaces the old static DEFAULT_KOFI_LINKS / ADDON_CATALOG[...].kofiLink
// maps — the URL is now generated per-click server-side (price and
// product resolved from public.plans / env-configured Creem product ids,
// never trusted from the client).

import { createClient } from "@/lib/supabase-browser";

export interface CreemCheckout {
  checkout_url: string;
}

type CreemCheckoutTarget =
  | { planId: string; addonSlug?: undefined }
  | { addonSlug: string; planId?: undefined };

export async function createCreemCheckout(target: CreemCheckoutTarget): Promise<CreemCheckout> {
  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("not_authenticated");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  const body =
    target.planId !== undefined
      ? { kind: "plan" as const, plan_id: target.planId }
      : { kind: "addon" as const, addon_slug: target.addonSlug };

  const res = await fetch(`${supabaseUrl}/functions/v1/creem-checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "checkout_creation_failed");
  }

  return res.json();
}