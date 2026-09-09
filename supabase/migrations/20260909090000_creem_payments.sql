-- Creem payment integration (replaces Ko-fi for Card/PayPal checkout).
--
-- supabase/functions/creem-webhook/index.ts requires both of the objects
-- below and will fail on the very first event without them:
--   - public.creem_events: idempotency log. Creem retries undelivered
--     webhooks with backoff (30s/1m/5m/1h) resending the same event.id —
--     the webhook does `insert ... event_id` and treats a unique_violation
--     (23505) as "already processed, return 200". Without a UNIQUE
--     constraint on event_id, every retry would re-apply the event.
--   - public.addon_subscriptions.creem_subscription_id: recurring add-ons
--     (monthly_digest, team_alerts) are matched/updated by this column on
--     subscription.paid / subscription.canceled / subscription.expired /
--     refund.created, the same way paddle_subscription_id already works
--     for Paddle-billed rows.
--
-- Plan subscriptions reuse the existing public.subscriptions.provider_subscription_id
-- column (already generic, not Paddle-specific) — no schema change needed there.

CREATE TABLE IF NOT EXISTS "public"."creem_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "email" "text",
    "raw_payload" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "creem_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "creem_events_event_id_key" UNIQUE ("event_id")
);

ALTER TABLE "public"."creem_events" OWNER TO "postgres";

-- Only the service role (Edge Functions run with SUPABASE_SERVICE_ROLE_KEY)
-- ever touches this table — no client-facing reads/writes, same pattern as
-- errors_logs and other webhook-only tables in this schema.
ALTER TABLE "public"."creem_events" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."addon_subscriptions"
    ADD COLUMN IF NOT EXISTS "creem_subscription_id" "text";

CREATE INDEX IF NOT EXISTS "idx_addon_subscriptions_creem_subscription_id"
    ON "public"."addon_subscriptions" USING "btree" ("creem_subscription_id")
    WHERE "creem_subscription_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_creem_events_created_at"
    ON "public"."creem_events" USING "btree" ("created_at");
