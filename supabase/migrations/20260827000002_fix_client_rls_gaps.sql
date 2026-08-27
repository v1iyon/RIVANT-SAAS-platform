-- ============================================================
-- Аудит 2026-08-27 v3 — пункты 1-4, 5, 8.
--
-- ------------------------------------------------------------
-- 1-2) match_incoming_payment() / reserve_order() открыты anon/authenticated
--      напрямую через PostgREST RPC (POST /rest/v1/rpc/...). Обе —
--      SECURITY DEFINER, обе не рассчитаны на прямой вызов клиентом:
--      match_incoming_payment() вообще не проверяет, что p_tx_hash /
--      p_amount_cents реально пришли из блокчейна — вызов с выдуманным
--      tx_hash и известным себе exact_amount_cents активирует подписку
--      без единого платежа. Вызывать должен только polygon-webhook под
--      service_role.
--
-- 3) Корневая причина: ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS
--    TO anon стоит на уровне схемы (дефолт Supabase-проекта) — каждая
--    новая функция автоматически становится публичной, если явно не
--    закрыть. Меняем дефолт, чтобы это не повторилось для будущих функций.
--
-- 4) current_app_user_id() / match_incoming_payment() / reserve_order()
--    объявлены без SET search_path — то, что подсвечивает Supabase
--    Security Advisor (function_search_path_mutable). current_app_user_id()
--    используется прямо в RLS-политике orders_select_own, поэтому мутабельный
--    search_path в SECURITY DEFINER функции, которая читает auth.uid(), —
--    реальный риск, а не только предупреждение линтера.
--
-- 8) orders_owner_read — мёртвая policy: orders.user_id заполняется
--    reserve_order() значением current_app_user_id() (= public.users.id),
--    а не auth.uid(), так что auth.uid() = user_id никогда не true.
--    Не дыра (доступ идёт через живую orders_select_own), но тот же
--    паттерн путаницы auth.uid() vs public.users.id, что и в п.5 ниже —
--    убираем, чтобы не путать при следующей правке.
-- ============================================================

-- --- 1-2) Закрыть прямой RPC-доступ для anon и authenticated --------------
-- service_role не трогаем — polygon-webhook вызывает эти функции под ним.
revoke execute on function "public"."match_incoming_payment"(
  "p_tx_hash" "text", "p_amount_cents" integer, "p_token" "text",
  "p_chain" "text", "p_tx_block_time" timestamp with time zone, "p_raw_activity" "jsonb"
) from "anon", "authenticated";

-- Проверено по коду: supabase/functions/create-order/index.ts (единственный
-- путь создания заказа) вставляет в orders напрямую через service_role
-- клиента и НЕ вызывает reserve_order() через RPC вообще — единственное
-- упоминание функции в коде это комментарий в polygon-webhook/index.ts.
-- Значит reserve_order() сейчас нигде не вызывается легитимно и может
-- быть закрыта полностью, без исключений для authenticated.
revoke execute on function "public"."reserve_order"(
  "p_base_amount_cents" integer, "p_receiving_wallet" "text",
  "p_chain" "text", "p_token" "text"
) from "anon", "authenticated";

-- --- 3) Новые функции больше не публикуются в anon/authenticated по умолчанию --
alter default privileges for role "postgres" in schema "public"
  revoke all on functions from "anon", "authenticated";

-- --- 4) SET search_path для трёх SECURITY DEFINER функций без него --------
alter function "public"."current_app_user_id"() set search_path = 'public';
alter function "public"."match_incoming_payment"(
  "p_tx_hash" "text", "p_amount_cents" integer, "p_token" "text",
  "p_chain" "text", "p_tx_block_time" timestamp with time zone, "p_raw_activity" "jsonb"
) set search_path = 'public';
alter function "public"."reserve_order"(
  "p_base_amount_cents" integer, "p_receiving_wallet" "text",
  "p_chain" "text", "p_token" "text"
) set search_path = 'public';

-- --- 5) subscriptions_owner_read сравнивала auth.uid() с user_id, но -----
--      subscriptions.user_id — это public.users.id (так пишут и
--      kofi-webhook, и app/api/webhooks/paddle/route.js). auth.uid() и
--      public.users.id — два разных UUID (см. комментарий в
--      AddonCheckoutModal.tsx про ту же индирекцию для businesses.user_id).
--      RLS никогда не отдавала строку клиенту -> Realtime-подписка и
--      15-секундный поллинг в PaymentModal.tsx всегда получали пусто,
--      экран "Waiting for payment confirmation" крутился бесконечно даже
--      после того как kofi-webhook уже активировал подписку на бэкенде.
--      См. также патч components/PaymentModal.tsx в этом же коммите —
--      без него фикс RLS сам по себе не поможет (клиент всё ещё будет
--      слать auth.uid() в фильтр .eq("user_id", ...)).
drop policy if exists "subscriptions_owner_read" on "public"."subscriptions";
create policy "subscriptions_owner_read"
  on "public"."subscriptions"
  for select
  using (
    "user_id" = "public"."current_app_user_id"()
  );

-- --- 8) Убрать мёртвую policy на orders ------------------------------------
-- orders_select_own (user_id = current_app_user_id()) остаётся и уже
-- покрывает весь легитимный доступ владельца заказа.
drop policy if exists "orders_owner_read" on "public"."orders";

-- --- Realtime: subscriptions ещё не в publication --------------------------
-- В дампе схемы supabase_realtime содержит только orders. Без этого
-- postgres_changes-подписка в PaymentModal.tsx не получит событие, даже
-- с исправленной RLS-политикой выше — тот же промах, что уже был с
-- addon_subscriptions в 20260827000002_fix_client_rls_gaps.sql.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'subscriptions'
  ) then
    alter publication supabase_realtime add table public.subscriptions;
  end if;
end $$;

comment on policy "subscriptions_owner_read" on "public"."subscriptions" is
  'Фикс: сравнение было auth.uid() = user_id, а subscriptions.user_id хранит public.users.id — RLS никогда не отдавала строку клиенту, Realtime/поллинг в PaymentModal.tsx всегда видели пусто. См. аудит 2026-08-27 v3, п.5.';