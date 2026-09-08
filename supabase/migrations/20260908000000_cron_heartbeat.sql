-- 20260908000000_cron_heartbeat.sql
--
-- FIX (чек-лист перед релизом, п. "Cron"): fallback на нативный GitHub
-- `schedule:` уже стоит рядом с основным cron-job.org (см. комментарий в
-- .github/workflows/sync-stripe.yml), но его "здоровье" нигде не видно —
-- если внешний cron-job.org замолчит (протух токен, кончился бесплатный
-- лимит и т.п.), об этом можно узнать только вручную зайдя в его личный
-- кабинет. Эта таблица — простой heartbeat: каждый прогон scripts/run-sync.mjs
-- пишет сюда время своего завершения, а сам же run-sync.mjs при СЛЕДУЮЩЕМ
-- запуске сверяет разрыв с прошлым heartbeat-ом и шлёт алерт владельцу в
-- Telegram, если разрыв заметно больше ожидаемых 15 минут (см.
-- lib/cron-heartbeat.mjs). RLS не нужен — читает/пишет только service role
-- из cron-скрипта, конечным пользователям эта таблица не отдаётся.

CREATE TABLE IF NOT EXISTS "public"."cron_heartbeat" (
    "job_name" text NOT NULL,
    "last_run_at" timestamptz NOT NULL,
    "status" text NOT NULL DEFAULT 'ok',
    "message" text,
    CONSTRAINT "cron_heartbeat_pkey" PRIMARY KEY ("job_name")
);

ALTER TABLE "public"."cron_heartbeat" OWNER TO "postgres";

REVOKE ALL ON TABLE "public"."cron_heartbeat" FROM anon, authenticated;
