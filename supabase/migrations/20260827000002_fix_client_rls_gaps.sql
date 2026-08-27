-- ============================================================
-- Фикс: RLS включён, но политик 0 -> клиентские запросы к этим
-- таблицам всегда возвращали пустой результат.
--
-- Найдено трассировкой всех .from(...) на клиентском (anon-key)
-- supabase-клиенте (lib/supabase-browser.ts) по всему репо:
--
-- 1) components/AddonCheckoutModal.tsx:211
--    supabase.from("businesses").select("id").eq("user_id", profile.id)
--    -> RLS на businesses включён, policy не было -> data всегда [].
--    -> businessId никогда не резолвился -> чекаут допуслуги ломался
--       в самой первой попытке (для юзеров, у которых businessId ещё
--       не был известен на момент открытия модалки).
--
-- 2) hooks/use-addon-subscription-status.ts
--    .from("addon_subscriptions").select(...).eq("business_id", ...)
--    + Realtime .on("postgres_changes", { table: "addon_subscriptions" })
--    -> RLS на addon_subscriptions включён, policy не было -> и поллинг,
--       и Realtime всегда возвращали пусто -> статус навсегда "pending",
--       подтверждение активации допуслуги в UI никогда не приходило.
--    -> Плюс addon_subscriptions вообще не была добавлена в publication
--       supabase_realtime, так что даже после фикса RLS Realtime-часть
--       не сработает без отдельного ALTER PUBLICATION ниже.
-- ============================================================

-- --- businesses: пользователь видит только свои бизнесы ------------------
-- businesses.user_id -> public.users.id (НЕ auth.uid() напрямую, см.
-- комментарий в AddonCheckoutModal.tsx про ту же индирекцию).
drop policy if exists "businesses_select_own" on public.businesses;
create policy "businesses_select_own"
  on public.businesses
  for select
  using (
    user_id = (
      select id from public.users where auth_user_id = auth.uid()
    )
  );

-- --- addon_subscriptions: пользователь видит подписки своих бизнесов -----
drop policy if exists "addon_subscriptions_select_own" on public.addon_subscriptions;
create policy "addon_subscriptions_select_own"
  on public.addon_subscriptions
  for select
  using (
    business_id in (
      select b.id
      from public.businesses b
      join public.users u on u.id = b.user_id
      where u.auth_user_id = auth.uid()
    )
  );

-- Явно НЕ добавляем insert/update/delete policy — эти мутации должны
-- по-прежнему идти только через service_role (webhook'и/крон), как и для
-- остальных платёжных таблиц в этом проекте.

-- --- Realtime: включить стриминг для addon_subscriptions -----------------
-- Без этого postgres_changes-подписка в use-addon-subscription-status.ts
-- никогда не получит событие, даже с рабочим RLS выше.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'addon_subscriptions'
  ) then
    alter publication supabase_realtime add table public.addon_subscriptions;
  end if;
end $$;

comment on policy "businesses_select_own" on public.businesses is
  'Фикс: клиентский .from("businesses") в AddonCheckoutModal.tsx возвращал 0 строк без этой policy.';
comment on policy "addon_subscriptions_select_own" on public.addon_subscriptions is
  'Фикс: клиентский .from("addon_subscriptions") и Realtime-подписка в use-addon-subscription-status.ts возвращали 0 строк без этой policy.';
