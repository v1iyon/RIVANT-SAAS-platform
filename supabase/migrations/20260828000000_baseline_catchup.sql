-- ============================================================
-- Baseline catch-up migration — 28.08.2026
--
-- Снимок РЕАЛЬНОЙ схемы продовой БД (pg_dump --schema-only), сделанный
-- чтобы файлы в supabase/migrations/ перестали расходиться с тем, что
-- реально развёрнуто. До этой миграции через CREATE TABLE в migrations/
-- было описано только 4 таблицы из 27 существующих, причём определения
-- orders/subscriptions в 0000_orders_subscriptions.sql были устаревшими
-- (см. пометку в начале того файла) — это и стало прямой причиной
-- критического бага, когда kofi-webhook/polygon-webhook писали в
-- несуществующие колонки subscriptions.plan_id/updated_at/last_order_id
-- и оплата не активировала подписку (RIVANT-audit-3-preLaunch.md, п.1).
--
-- ⚠️ ВАЖНО, как этим пользоваться:
--
-- Это ПОЛНЫЙ дамп схемы (CREATE TABLE, RLS policies, triggers, functions,
-- constraints, indexes) как есть, снятый с продовой БД. CREATE TABLE
-- обёрнуты в IF NOT EXISTS — их можно безопасно прогнать повторно.
-- НО: ALTER TABLE ... ADD CONSTRAINT, CREATE POLICY и CREATE TRIGGER
-- в стандартном pg_dump НЕ идемпотентны — на уже живой продовой БД,
-- где эти constraint/policy/trigger уже существуют, эта миграция
-- упадёт с ошибкой "already exists".
--
-- Поэтому:
--   1) На ПРОДЕ эту миграцию не "применяют" обычным способом — её
--      нужно зарегистрировать как уже применённую (baseline), например
--      через `supabase migration repair --status applied <version>`,
--      НЕ прогоняя реально SQL (объекты и так уже есть в проде).
--   2) На ЧИСТОМ/новом окружении (staging, локальная БД для разработки,
--      CI) эту миграцию прогоняют как обычно первой — она создаст
--      структуру с нуля 1-в-1 как в проде.
--
-- Это снимок на 27-28.08.2026, а не автоматически поддерживаемый
-- источник правды навсегда — следующее ручное изменение в Supabase
-- Studio снова разойдётся с этим файлом, если не оформлять такие
-- изменения отдельной миграцией сразу же.
-- ============================================================

SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."current_app_user_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  select id from public.users where auth_user_id = auth.uid();
$$;


ALTER FUNCTION "public"."current_app_user_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_stale_orders"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  expired_count integer;
begin
  update public.orders
  set status = 'expired'
  where status = 'pending'
    and expires_at < now();

  get diagnostics expired_count = row_count;
  return expired_count;
end;
$$;


ALTER FUNCTION "public"."expire_stale_orders"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."expire_stale_orders"() IS 'Переводит orders.status в expired для всех pending-заказов с истёкшим expires_at. Идемпотентна, безопасна для повторных вызовов. См. аудит FINAL B2 — сейчас вызывается только вручную/из Edge Function expire-orders, pg_cron-расписание намеренно не подключено (осознанное решение, не забыть вернуться).';



CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.users
  set auth_user_id = new.id
  where email = new.email
    and auth_user_id is null;

  if not found then
    insert into public.users (id, auth_user_id, email, full_name, language, created_at)
    values (
      gen_random_uuid(),
      new.id,
      new.email,
      new.raw_user_meta_data->>'full_name',
      coalesce(new.raw_user_meta_data->>'language', 'EN'),
      now()
    )
    on conflict (email) do nothing;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_incoming_payment"("p_tx_hash" "text", "p_amount_cents" integer, "p_token" "text", "p_chain" "text", "p_tx_block_time" timestamp with time zone, "p_raw_activity" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_order orders;
begin
  select * into v_order
  from orders
  where exact_amount_cents = p_amount_cents
    and status = 'pending'
  limit 1;
 
  if v_order.id is null then
    insert into unmatched_payments (tx_hash, amount_cents, token, raw_activity)
    values (p_tx_hash, p_amount_cents, p_token,
            p_raw_activity || jsonb_build_object('reason', 'no_pending_order', 'chain', p_chain));
    return 'no_pending_order';
  end if;
 
  if v_order.expires_at < now() then
    update orders set status = 'expired' where id = v_order.id;
    insert into unmatched_payments (tx_hash, amount_cents, token, raw_activity)
    values (p_tx_hash, p_amount_cents, p_token,
            p_raw_activity || jsonb_build_object('reason', 'expired', 'chain', p_chain, 'order_id', v_order.id));
    return 'expired';
  end if;
 
  if not (p_tx_block_time > v_order.created_at - interval '30 seconds') then
    insert into unmatched_payments (tx_hash, amount_cents, token, raw_activity)
    values (p_tx_hash, p_amount_cents, p_token,
            p_raw_activity || jsonb_build_object('reason', 'time_window_violation', 'chain', p_chain, 'order_id', v_order.id));
    return 'time_window_violation';
  end if;
 
  update orders
  set status = 'success',
      tx_hash = p_tx_hash,
      tx_block_time = p_tx_block_time,
      matched_at = now()
  where id = v_order.id
    and status = 'pending';
 
  if not found then
    insert into unmatched_payments (tx_hash, amount_cents, token, raw_activity)
    values (p_tx_hash, p_amount_cents, p_token,
            p_raw_activity || jsonb_build_object('reason', 'race_condition', 'chain', p_chain, 'order_id', v_order.id));
    return 'race_condition';
  end if;
 
  update users
  set has_active_subscription = true,
      subscription_expires_at = greatest(coalesce(subscription_expires_at, now()), now()) + interval '30 days'
  where id = v_order.user_id;
 
  return 'matched';
end;
$$;


ALTER FUNCTION "public"."match_incoming_payment"("p_tx_hash" "text", "p_amount_cents" integer, "p_token" "text", "p_chain" "text", "p_tx_block_time" timestamp with time zone, "p_raw_activity" "jsonb") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "base_amount_cents" integer NOT NULL,
    "cents_offset" smallint NOT NULL,
    "exact_amount_cents" integer GENERATED ALWAYS AS (("base_amount_cents" + "cents_offset")) STORED,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "tx_hash" "text",
    "chain" "text" DEFAULT 'polygon'::"text" NOT NULL,
    "token" "text" DEFAULT 'USDC'::"text" NOT NULL,
    "receiving_wallet" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:30:00'::interval) NOT NULL,
    "matched_at" timestamp with time zone,
    "tx_block_time" timestamp with time zone,
    "plan_id" "text",
    "kind" "text" DEFAULT 'plan'::"text",
    "addon_kind" "text",
    "addon_slug" "text",
    CONSTRAINT "orders_addon_kind_check" CHECK ((("addon_kind" IS NULL) OR ("addon_kind" = ANY (ARRAY['order'::"text", 'subscription'::"text"])))),
    CONSTRAINT "orders_kind_check" CHECK (("kind" = ANY (ARRAY['plan'::"text", 'addon'::"text"]))),
    CONSTRAINT "orders_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'success'::"text", 'expired'::"text", 'fraud_flagged'::"text"])))
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reserve_order"("p_base_amount_cents" integer, "p_receiving_wallet" "text", "p_chain" "text" DEFAULT 'polygon'::"text", "p_token" "text" DEFAULT 'USDC'::"text") RETURNS "public"."orders"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_user_id uuid := current_app_user_id();
  v_offset smallint;
  v_exact integer;
  v_attempts int := 0;
  v_order orders;
begin
  if v_user_id is null then
    raise exception 'No matching public.users row for current auth session';
  end if;
 
  if p_base_amount_cents not in (9900, 29900, 49900) then
    raise exception 'Unexpected base_amount_cents: %', p_base_amount_cents;
  end if;
 
  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 200 then
      raise exception 'Could not reserve a unique amount after % attempts', v_attempts;
    end if;
 
    v_offset := 1 + floor(random() * 99)::int;
    v_exact := p_base_amount_cents + v_offset;
 
    begin
      insert into orders (
        user_id, base_amount_cents, cents_offset, exact_amount_cents,
        status, chain, token, receiving_wallet, expires_at
      )
      values (
        v_user_id, p_base_amount_cents, v_offset, v_exact,
        'pending', p_chain, p_token, p_receiving_wallet, now() + interval '30 minutes'
      )
      returning * into v_order;
 
      return v_order;
    exception when unique_violation then
      continue;
    end;
  end loop;
end;
$$;


ALTER FUNCTION "public"."reserve_order"("p_base_amount_cents" integer, "p_receiving_wallet" "text", "p_chain" "text", "p_token" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."addon_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "addon_type" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "paddle_subscription_id" "text",
    "current_period_end" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "addon_subscriptions_addon_type_check" CHECK (("addon_type" = ANY (ARRAY['team_alerts'::"text", 'monthly_digest'::"text"]))),
    CONSTRAINT "addon_subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'expired'::"text", 'canceled'::"text"])))
);


ALTER TABLE "public"."addon_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."alert_rules" (
    "id" bigint NOT NULL,
    "business_id" "uuid",
    "metric" "text" NOT NULL,
    "threshold_pct" numeric DEFAULT 15,
    "enabled" boolean DEFAULT true
);


ALTER TABLE "public"."alert_rules" OWNER TO "postgres";


ALTER TABLE "public"."alert_rules" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."alert_rules_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."alerts_log" (
    "id" bigint NOT NULL,
    "business_id" "uuid",
    "type" "text" NOT NULL,
    "message" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text",
    "sent_at" timestamp with time zone DEFAULT "now"(),
    "ai_explanation" "text",
    "severity" "text" DEFAULT 'medium'::"text"
);


ALTER TABLE "public"."alerts_log" OWNER TO "postgres";


ALTER TABLE "public"."alerts_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."alerts_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."broadcast_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message" "text" NOT NULL,
    "sent_telegram" boolean DEFAULT false NOT NULL,
    "sent_inapp" boolean DEFAULT false NOT NULL,
    "telegram_sent_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "message_en" "text",
    "message_ua" "text",
    "message_de" "text"
);


ALTER TABLE "public"."broadcast_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."businesses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "currency" "text" DEFAULT 'USD'::"text",
    "timezone" "text" DEFAULT 'America/New_York'::"text",
    "cost_pct" numeric DEFAULT 0,
    "alert_sensitivity" "text" DEFAULT 'normal'::"text" NOT NULL,
    "digest_frequency" "text" DEFAULT 'both'::"text" NOT NULL,
    CONSTRAINT "businesses_alert_sensitivity_check" CHECK (("alert_sensitivity" = ANY (ARRAY['low'::"text", 'normal'::"text", 'high'::"text"])))
);


ALTER TABLE "public"."businesses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."error_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source" "text" NOT NULL,
    "message" "text" NOT NULL,
    "details" "text",
    "business_id" "uuid",
    "resolved" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."error_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."expenses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "amount" numeric NOT NULL,
    "category" "text" NOT NULL,
    "description" "text",
    "date" "date" NOT NULL,
    "source" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "expenses_category_check" CHECK (("category" = ANY (ARRAY['advertising'::"text", 'shipping'::"text", 'cost_of_goods'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."expenses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "email" "text",
    "type" "text" DEFAULT 'bug'::"text" NOT NULL,
    "message" "text" NOT NULL,
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."forecast_cache" (
    "business_id" "uuid" NOT NULL,
    "days" integer NOT NULL,
    "language" "text" NOT NULL,
    "explanation" "text" NOT NULL,
    "generated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "numbers" "jsonb",
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL
);


ALTER TABLE "public"."forecast_cache" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."integrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "api_key_encrypted" "text",
    "key_preview" "text",
    "status" "text" DEFAULT 'disconnected'::"text" NOT NULL,
    "last_synced_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "last_sync" timestamp with time zone,
    "key_encrypted" "text",
    "config" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."integrations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."interest_signals" (
    "id" bigint NOT NULL,
    "business_id" "uuid",
    "email" "text" NOT NULL,
    "response" "text" NOT NULL,
    "trial_ends_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "interest_signals_response_check" CHECK (("response" = ANY (ARRAY['yes'::"text", 'not_now'::"text"])))
);


ALTER TABLE "public"."interest_signals" OWNER TO "postgres";


ALTER TABLE "public"."interest_signals" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."interest_signals_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."kofi_transactions" (
    "kofi_transaction_id" "text" NOT NULL,
    "email" "text" NOT NULL,
    "plan_id" "text",
    "raw_payload" "jsonb",
    "processed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."kofi_transactions" OWNER TO "postgres";


COMMENT ON TABLE "public"."kofi_transactions" IS 'Лог обработанных Ko-fi webhook-платежей для идемпотентности (защита от повторной активации при retry).';



CREATE TABLE IF NOT EXISTS "public"."leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text",
    "company" "text",
    "email" "text" NOT NULL,
    "telegram" "text",
    "message" "text",
    "source" "text",
    "status" "text" DEFAULT 'new'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."leads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."link_tokens" (
    "token" "text" NOT NULL,
    "user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "used" boolean DEFAULT false,
    "expires_at" timestamp with time zone
);


ALTER TABLE "public"."link_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."metrics_computed" (
    "id" bigint NOT NULL,
    "business_id" "uuid",
    "date" "date" NOT NULL,
    "revenue" numeric,
    "cost" numeric,
    "margin_pct" numeric,
    "orders" integer,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."metrics_computed" OWNER TO "postgres";


ALTER TABLE "public"."metrics_computed" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."metrics_computed_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."plans" (
    "id" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "base_amount_cents" integer NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "plans_base_amount_cents_check" CHECK (("base_amount_cents" > 0))
);


ALTER TABLE "public"."plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "author_name" "text" NOT NULL,
    "business_name" "text",
    "rating" integer NOT NULL,
    "comment" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "reviews_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "service_type" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "paddle_transaction_id" "text",
    "report_summary" "text",
    "delivered_at" timestamp with time zone,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "service_orders_service_type_check" CHECK (("service_type" = ANY (ARRAY['whatif_analysis'::"text", 'monthly_digest'::"text"]))),
    CONSTRAINT "service_orders_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'delivered'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."service_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "plan" "text" DEFAULT 'trial'::"text" NOT NULL,
    "access_status" "text" DEFAULT 'trial'::"text" NOT NULL,
    "current_period_end" timestamp with time zone,
    "provider_subscription_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "paddle_subscription_id" "text",
    "integrations_selected" "jsonb" DEFAULT '[]'::"jsonb"
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_alert_deliveries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "telegram_id" "text" NOT NULL,
    "type" "text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."team_alert_deliveries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_invites" (
    "token" "text" NOT NULL,
    "business_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "used_by_telegram_id" bigint,
    "used" boolean DEFAULT false NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "categories" "text"[] DEFAULT ARRAY['revenue'::"text", 'marketing'::"text", 'inventory'::"text", 'technical'::"text"] NOT NULL,
    CONSTRAINT "team_invites_categories_valid" CHECK (("categories" <@ ARRAY['revenue'::"text", 'marketing'::"text", 'inventory'::"text", 'technical'::"text"]))
);


ALTER TABLE "public"."team_invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "telegram_id" bigint NOT NULL,
    "telegram_username" "text",
    "invited_by" "uuid",
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone,
    "categories" "text"[] DEFAULT ARRAY['revenue'::"text", 'marketing'::"text", 'inventory'::"text", 'technical'::"text"] NOT NULL,
    CONSTRAINT "team_members_categories_valid" CHECK (("categories" <@ ARRAY['revenue'::"text", 'marketing'::"text", 'inventory'::"text", 'technical'::"text"])),
    CONSTRAINT "team_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'member'::"text"]))),
    CONSTRAINT "team_members_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'revoked'::"text"])))
);


ALTER TABLE "public"."team_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."unmatched_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tx_hash" "text" NOT NULL,
    "amount_cents" integer NOT NULL,
    "token" "text",
    "raw_activity" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."unmatched_payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_events" (
    "id" bigint NOT NULL,
    "business_id" "uuid",
    "user_id" "uuid",
    "event_type" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_events" OWNER TO "postgres";


ALTER TABLE "public"."user_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."user_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."user_widget_prefs" (
    "user_id" "uuid" NOT NULL,
    "widget_ids" "text"[] NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_widget_prefs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "telegram_id" bigint,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "language" "text" DEFAULT 'EN'::"text",
    "full_name" "text",
    "phone" "text",
    "avatar_url" "text",
    "push_enabled" boolean DEFAULT true,
    "email_enabled" boolean DEFAULT true,
    "is_blocked" boolean DEFAULT false NOT NULL,
    "last_seen_broadcast_at" timestamp with time zone,
    "has_active_subscription" boolean DEFAULT false NOT NULL,
    "subscription_expires_at" timestamp with time zone,
    "auth_user_id" "uuid",
    "onboarding_completed" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."users" OWNER TO "postgres";


ALTER TABLE ONLY "public"."addon_subscriptions"
    ADD CONSTRAINT "addon_subscriptions_business_id_addon_type_key" UNIQUE ("business_id", "addon_type");



ALTER TABLE ONLY "public"."addon_subscriptions"
    ADD CONSTRAINT "addon_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."alert_rules"
    ADD CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."alerts_log"
    ADD CONSTRAINT "alerts_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."broadcast_notifications"
    ADD CONSTRAINT "broadcast_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."businesses"
    ADD CONSTRAINT "businesses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."error_logs"
    ADD CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."forecast_cache"
    ADD CONSTRAINT "forecast_cache_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_business_id_provider_key" UNIQUE ("business_id", "provider");



ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."interest_signals"
    ADD CONSTRAINT "interest_signals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kofi_transactions"
    ADD CONSTRAINT "kofi_transactions_pkey" PRIMARY KEY ("kofi_transaction_id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."link_tokens"
    ADD CONSTRAINT "link_tokens_pkey" PRIMARY KEY ("token");



ALTER TABLE ONLY "public"."metrics_computed"
    ADD CONSTRAINT "metrics_computed_business_date_unique" UNIQUE ("business_id", "date");



ALTER TABLE ONLY "public"."metrics_computed"
    ADD CONSTRAINT "metrics_computed_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plans"
    ADD CONSTRAINT "plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_orders"
    ADD CONSTRAINT "service_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."team_alert_deliveries"
    ADD CONSTRAINT "team_alert_deliveries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_invites"
    ADD CONSTRAINT "team_invites_pkey" PRIMARY KEY ("token");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_business_id_telegram_id_key" UNIQUE ("business_id", "telegram_id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."unmatched_payments"
    ADD CONSTRAINT "unmatched_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."unmatched_payments"
    ADD CONSTRAINT "unmatched_payments_tx_hash_key" UNIQUE ("tx_hash");



ALTER TABLE ONLY "public"."user_events"
    ADD CONSTRAINT "user_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_widget_prefs"
    ADD CONSTRAINT "user_widget_prefs_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_auth_user_id_key" UNIQUE ("auth_user_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_telegram_id_key" UNIQUE ("telegram_id");



CREATE INDEX "error_logs_resolved_idx" ON "public"."error_logs" USING "btree" ("resolved");



CREATE INDEX "error_logs_source_idx" ON "public"."error_logs" USING "btree" ("source");



CREATE INDEX "forecast_cache_business_id_idx" ON "public"."forecast_cache" USING "btree" ("business_id");



CREATE INDEX "idx_addon_subs_expiry" ON "public"."addon_subscriptions" USING "btree" ("current_period_end") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_alerts_business_status" ON "public"."alerts_log" USING "btree" ("business_id", "status");



CREATE INDEX "idx_expenses_business_date" ON "public"."expenses" USING "btree" ("business_id", "date");



CREATE INDEX "idx_metrics_business_date" ON "public"."metrics_computed" USING "btree" ("business_id", "date");



CREATE INDEX "idx_service_orders_pending" ON "public"."service_orders" USING "btree" ("status") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_subscriptions_paddle_sub" ON "public"."subscriptions" USING "btree" ("paddle_subscription_id");



CREATE INDEX "idx_team_members_business" ON "public"."team_members" USING "btree" ("business_id") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_user_events_user" ON "public"."user_events" USING "btree" ("user_id", "event_type");



CREATE INDEX "orders_amount_idx" ON "public"."orders" USING "btree" ("exact_amount_cents");



CREATE UNIQUE INDEX "orders_pending_amount_unique" ON "public"."orders" USING "btree" ("exact_amount_cents") WHERE ("status" = 'pending'::"text");



CREATE INDEX "orders_plan_id_idx" ON "public"."orders" USING "btree" ("plan_id");



CREATE INDEX "orders_status_expires_idx" ON "public"."orders" USING "btree" ("status", "expires_at");



CREATE INDEX "orders_status_idx" ON "public"."orders" USING "btree" ("status");



CREATE UNIQUE INDEX "orders_tx_hash_unique" ON "public"."orders" USING "btree" ("tx_hash") WHERE ("tx_hash" IS NOT NULL);



CREATE INDEX "orders_user_idx" ON "public"."orders" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "team_alert_deliveries_lookup_idx" ON "public"."team_alert_deliveries" USING "btree" ("business_id", "telegram_id", "type", "sent_at" DESC);



CREATE INDEX "users_is_blocked_idx" ON "public"."users" USING "btree" ("is_blocked");



ALTER TABLE ONLY "public"."addon_subscriptions"
    ADD CONSTRAINT "addon_subscriptions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."alert_rules"
    ADD CONSTRAINT "alert_rules_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."alerts_log"
    ADD CONSTRAINT "alerts_log_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."businesses"
    ADD CONSTRAINT "businesses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."error_logs"
    ADD CONSTRAINT "error_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."forecast_cache"
    ADD CONSTRAINT "forecast_cache_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."interest_signals"
    ADD CONSTRAINT "interest_signals_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id");



ALTER TABLE ONLY "public"."link_tokens"
    ADD CONSTRAINT "link_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."metrics_computed"
    ADD CONSTRAINT "metrics_computed_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_orders"
    ADD CONSTRAINT "service_orders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_orders"
    ADD CONSTRAINT "service_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_invites"
    ADD CONSTRAINT "team_invites_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_invites"
    ADD CONSTRAINT "team_invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."user_events"
    ADD CONSTRAINT "user_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id");



ALTER TABLE ONLY "public"."user_events"
    ADD CONSTRAINT "user_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."user_widget_prefs"
    ADD CONSTRAINT "user_widget_prefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."addon_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."alert_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."alerts_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."broadcast_notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."businesses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."error_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."expenses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feedback" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."forecast_cache" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."integrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."interest_signals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kofi_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."link_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."metrics_computed" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "orders_no_direct_insert" ON "public"."orders" FOR INSERT WITH CHECK (false);



CREATE POLICY "orders_no_direct_update" ON "public"."orders" FOR UPDATE USING (false);



CREATE POLICY "orders_owner_read" ON "public"."orders" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "orders_select_own" ON "public"."orders" FOR SELECT USING (("user_id" = "public"."current_app_user_id"()));



ALTER TABLE "public"."plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "plans_public_read" ON "public"."plans" FOR SELECT USING (("is_active" = true));



ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."service_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscriptions_owner_read" ON "public"."subscriptions" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."team_alert_deliveries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."unmatched_payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_widget_prefs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users can read own row" ON "public"."users" FOR SELECT USING (("auth_user_id" = "auth"."uid"()));



CREATE POLICY "users_select_own" ON "public"."users" FOR SELECT USING (("auth_user_id" = "auth"."uid"()));



CREATE POLICY "users_update_own_profile" ON "public"."users" FOR UPDATE USING (("auth_user_id" = "auth"."uid"())) WITH CHECK ((("auth_user_id" = "auth"."uid"()) AND ("has_active_subscription" = ( SELECT "users_1"."has_active_subscription"
   FROM "public"."users" "users_1"
  WHERE ("users_1"."auth_user_id" = "auth"."uid"()))) AND (NOT ("subscription_expires_at" IS DISTINCT FROM ( SELECT "users_1"."subscription_expires_at"
   FROM "public"."users" "users_1"
  WHERE ("users_1"."auth_user_id" = "auth"."uid"()))))));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."orders";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";














































































































































































GRANT ALL ON FUNCTION "public"."current_app_user_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_app_user_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_app_user_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."expire_stale_orders"() TO "anon";
GRANT ALL ON FUNCTION "public"."expire_stale_orders"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."expire_stale_orders"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."match_incoming_payment"("p_tx_hash" "text", "p_amount_cents" integer, "p_token" "text", "p_chain" "text", "p_tx_block_time" timestamp with time zone, "p_raw_activity" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."match_incoming_payment"("p_tx_hash" "text", "p_amount_cents" integer, "p_token" "text", "p_chain" "text", "p_tx_block_time" timestamp with time zone, "p_raw_activity" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."match_incoming_payment"("p_tx_hash" "text", "p_amount_cents" integer, "p_token" "text", "p_chain" "text", "p_tx_block_time" timestamp with time zone, "p_raw_activity" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."match_incoming_payment"("p_tx_hash" "text", "p_amount_cents" integer, "p_token" "text", "p_chain" "text", "p_tx_block_time" timestamp with time zone, "p_raw_activity" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



REVOKE ALL ON FUNCTION "public"."reserve_order"("p_base_amount_cents" integer, "p_receiving_wallet" "text", "p_chain" "text", "p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reserve_order"("p_base_amount_cents" integer, "p_receiving_wallet" "text", "p_chain" "text", "p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reserve_order"("p_base_amount_cents" integer, "p_receiving_wallet" "text", "p_chain" "text", "p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reserve_order"("p_base_amount_cents" integer, "p_receiving_wallet" "text", "p_chain" "text", "p_token" "text") TO "service_role";
























GRANT ALL ON TABLE "public"."addon_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."addon_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."addon_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."alert_rules" TO "anon";
GRANT ALL ON TABLE "public"."alert_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."alert_rules" TO "service_role";



GRANT ALL ON SEQUENCE "public"."alert_rules_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."alert_rules_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."alert_rules_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."alerts_log" TO "anon";
GRANT ALL ON TABLE "public"."alerts_log" TO "authenticated";
GRANT ALL ON TABLE "public"."alerts_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."alerts_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."alerts_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."alerts_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."broadcast_notifications" TO "anon";
GRANT ALL ON TABLE "public"."broadcast_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."broadcast_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."businesses" TO "anon";
GRANT ALL ON TABLE "public"."businesses" TO "authenticated";
GRANT ALL ON TABLE "public"."businesses" TO "service_role";



GRANT ALL ON TABLE "public"."error_logs" TO "anon";
GRANT ALL ON TABLE "public"."error_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."error_logs" TO "service_role";



GRANT ALL ON TABLE "public"."expenses" TO "anon";
GRANT ALL ON TABLE "public"."expenses" TO "authenticated";
GRANT ALL ON TABLE "public"."expenses" TO "service_role";



GRANT ALL ON TABLE "public"."feedback" TO "anon";
GRANT ALL ON TABLE "public"."feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."feedback" TO "service_role";



GRANT ALL ON TABLE "public"."forecast_cache" TO "anon";
GRANT ALL ON TABLE "public"."forecast_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."forecast_cache" TO "service_role";



GRANT ALL ON TABLE "public"."integrations" TO "anon";
GRANT ALL ON TABLE "public"."integrations" TO "authenticated";
GRANT ALL ON TABLE "public"."integrations" TO "service_role";



GRANT ALL ON TABLE "public"."interest_signals" TO "anon";
GRANT ALL ON TABLE "public"."interest_signals" TO "authenticated";
GRANT ALL ON TABLE "public"."interest_signals" TO "service_role";



GRANT ALL ON SEQUENCE "public"."interest_signals_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."interest_signals_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."interest_signals_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kofi_transactions" TO "anon";
GRANT ALL ON TABLE "public"."kofi_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."kofi_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."leads" TO "anon";
GRANT ALL ON TABLE "public"."leads" TO "authenticated";
GRANT ALL ON TABLE "public"."leads" TO "service_role";



GRANT ALL ON TABLE "public"."link_tokens" TO "anon";
GRANT ALL ON TABLE "public"."link_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."link_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."metrics_computed" TO "anon";
GRANT ALL ON TABLE "public"."metrics_computed" TO "authenticated";
GRANT ALL ON TABLE "public"."metrics_computed" TO "service_role";



GRANT ALL ON SEQUENCE "public"."metrics_computed_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."metrics_computed_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."metrics_computed_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."plans" TO "anon";
GRANT ALL ON TABLE "public"."plans" TO "authenticated";
GRANT ALL ON TABLE "public"."plans" TO "service_role";



GRANT ALL ON TABLE "public"."reviews" TO "anon";
GRANT ALL ON TABLE "public"."reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."reviews" TO "service_role";



GRANT ALL ON TABLE "public"."service_orders" TO "anon";
GRANT ALL ON TABLE "public"."service_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."service_orders" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."team_alert_deliveries" TO "anon";
GRANT ALL ON TABLE "public"."team_alert_deliveries" TO "authenticated";
GRANT ALL ON TABLE "public"."team_alert_deliveries" TO "service_role";



GRANT ALL ON TABLE "public"."team_invites" TO "anon";
GRANT ALL ON TABLE "public"."team_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."team_invites" TO "service_role";



GRANT ALL ON TABLE "public"."team_members" TO "anon";
GRANT ALL ON TABLE "public"."team_members" TO "authenticated";
GRANT ALL ON TABLE "public"."team_members" TO "service_role";



GRANT ALL ON TABLE "public"."unmatched_payments" TO "anon";
GRANT ALL ON TABLE "public"."unmatched_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."unmatched_payments" TO "service_role";



GRANT ALL ON TABLE "public"."user_events" TO "anon";
GRANT ALL ON TABLE "public"."user_events" TO "authenticated";
GRANT ALL ON TABLE "public"."user_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."user_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."user_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_widget_prefs" TO "anon";
GRANT ALL ON TABLE "public"."user_widget_prefs" TO "authenticated";
GRANT ALL ON TABLE "public"."user_widget_prefs" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";