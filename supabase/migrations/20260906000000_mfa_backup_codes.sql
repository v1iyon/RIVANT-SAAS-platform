-- 20260906000000_mfa_backup_codes.sql
--
-- Таблиця для одноразових backup-кодів 2FA. Кожен ряд — ОДИН код одного
-- користувача. Зберігається лише HMAC-хеш (lib/mfa-backup-codes.js), не
-- сам код — так само, як api_key_encrypted в integrations ніколи не
-- зберігає сирий ключ у відкритому вигляді.
--
-- user_id — це auth.users.id (той самий id, що повертає
-- lib/require-user.ts::requireUser() і що потрібен для
-- supabase.auth.admin.mfa.deleteFactor({ userId })), а НЕ public.users.id.
CREATE TABLE IF NOT EXISTS "public"."mfa_backup_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "code_hash" "text" NOT NULL,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mfa_backup_codes_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."mfa_backup_codes" OWNER TO "postgres";

CREATE INDEX IF NOT EXISTS "idx_mfa_backup_codes_user" ON "public"."mfa_backup_codes" USING "btree" ("user_id");

-- Один код не може повторюватись у межах усієї таблиці (не тільки для
-- одного user_id) — коди генеруються з достатньою ентропією (lib/
-- mfa-backup-codes.js, 10 випадкових alphanumeric символів), тому колізія
-- практично неможлива, але цей констрейнт перетворює теоретичну колізію
-- на явну помилку генерації, а не на тихе перезаписування чужого коду.
ALTER TABLE "public"."mfa_backup_codes"
    ADD CONSTRAINT "mfa_backup_codes_code_hash_key" UNIQUE ("code_hash");

ALTER TABLE ONLY "public"."mfa_backup_codes"
    ADD CONSTRAINT "mfa_backup_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE "public"."mfa_backup_codes" ENABLE ROW LEVEL SECURITY;

-- Немає client-side політик навмисно: усі запити до цієї таблиці йдуть
-- ВИКЛЮЧНО через service_role (app/api/mfa/*), той самий підхід, що і для
-- integrations.api_key_encrypted — секретний матеріал не повинен бути
-- читабельним напряму через anon/authenticated роль навіть теоретично.
GRANT ALL ON TABLE "public"."mfa_backup_codes" TO "service_role";
