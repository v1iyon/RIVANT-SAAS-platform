"use client";

// Calls the create-order Edge Function and returns data for the payment
// window. The user is resolved server-side from the session token
// (Authorization: Bearer <access_token>) — never passed manually.
//
// The price is looked up server-side (from public.plans for plans, and
// server-side for addons too — client never sends an amount) — the
// client only ever sends WHAT was picked (plan id, or addon kind+slug),
// never an amount.
//
// CHANGELOG (crypto for add-ons, п.1 of the plan):
//   createCryptoOrder now accepts either a plan target (unchanged,
//   existing call sites like `createCryptoOrder({ planId })` in
//   PaymentModal.tsx keep working with no changes) or a new addon target
//   `{ addonKind, addonSlug }`. Both branches POST to the same
//   create-order Edge Function; the function is expected to branch on
//   `kind` server-side and, for addons, write the SAME `orders` columns
//   polygon-webhook now reads: kind = 'addon', addon_kind, addon_slug
//   (see the polygon-webhook patch — those two files must agree on these
//   names). addon_kind mirrors kofi-webhook's AddonMapping union:
//   'order' for one-time services (whatif_analysis -> service_orders),
//   'subscription' for recurring addons (monthly_digest, team_alerts ->
//   addon_subscriptions).

import { createClient } from "@/lib/supabase-browser";

export interface CryptoOrder {
  order_id: string;
  amount_to_send: string; // e.g. "99.42"
  token: string; // "USDC"
  chain: string; // "polygon"
  receiving_wallet: string;
  expires_at: string;
}

type CryptoOrderTarget =
  | { planId: string; addonKind?: undefined; addonSlug?: undefined }
  | { addonKind: "order" | "subscription"; addonSlug: string; planId?: undefined };

export async function createCryptoOrder(
  target: CryptoOrderTarget & { token?: string },
): Promise<CryptoOrder> {
  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("not_authenticated");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const token = target.token ?? "USDC";

  const body =
    target.planId !== undefined
      ? { kind: "plan" as const, plan_id: target.planId, token }
      : { kind: "addon" as const, addon_kind: target.addonKind, addon_slug: target.addonSlug, token };

  const res = await fetch(`${supabaseUrl}/functions/v1/create-order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "order_creation_failed");
  }

  return res.json();
}