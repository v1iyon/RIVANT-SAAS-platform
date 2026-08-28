-- ============================================================
-- ⚠️ HISTORICAL / SUPERSEDED — не отражает актуальную схему БД.
--
-- Эта миграция описывает раннюю версию `orders`/`subscriptions`
-- (enum plan_type, колонки last_order_id/updated_at и т.д.). Реальная
-- схема этих таблиц с тех пор много раз менялась вручную в Supabase
-- Studio, БЕЗ соответствующих миграций (см. п.2 "Схема БД почти не
-- отражена в миграциях" в RIVANT-audit-3-preLaunch.md). Актуальная
-- структура — в supabase/schema_dump_27_08.sql и в новой миграции
-- 20260828000000_baseline_catchup.sql (снимок реальной схемы на 27.08,
-- сгенерированный именно чтобы файлы миграций перестали врать).
--
-- Не запускай этот файл на актуальной БД как есть — он создаёт
-- objects (тип plan_type, старые колонки), которых в реальной схеме
-- уже нет / не совпадают. Оставлен только как исторический контекст,
-- откуда взялся баг с рассинхроном имён колонок в kofi-webhook и
-- polygon-webhook (plan_id/updated_at/last_order_id/last_tx_hash —
-- ровно те поля, что описаны ниже, но которых нет в реальной БД).
-- ============================================================

-- ============================================================
-- RIVANT SaaS: orders + subscriptions
-- ============================================================

-- Расширение для gen_random_uuid()
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- ENUM-типы (строго ограничивают допустимые значения)
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type order_status as enum ('pending', 'success', 'failed');
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_provider') then
    create type payment_provider as enum ('kofi');
  end if;

  if not exists (select 1 from pg_type where typname = 'plan_type') then
    create type plan_type as enum ('growth', 'premium', 'enterprise'); -- growth=$99, premium=$299, enterprise=$499
  end if;

  if not exists (select 1 from pg_type where typname = 'access_status') then
    create type access_status as enum ('active', 'expired', 'canceled');
  end if;
end $$;

-- ------------------------------------------------------------
-- Таблица orders
-- ------------------------------------------------------------
create table if not exists public.orders (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references auth.users(id) on delete set null,
  email              text not null,                 -- email из Ko-fi payload (может отличаться от auth email до матчинга)
  amount             numeric(10, 2) not null,
  currency           text not null default 'USD',
  plan_type          plan_type,
  status             order_status not null default 'pending',
  provider           payment_provider not null default 'kofi',
  provider_txn_id    text,                           -- kofi_transaction_id — для идемпотентности
  raw_payload        jsonb,                          -- сырой payload от Ko-fi, полезно для дебага/аудита
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Идемпотентность: один и тот же kofi_transaction_id не должен создавать дубликаты заказов
create unique index if not exists orders_provider_txn_id_uidx
  on public.orders (provider, provider_txn_id)
  where provider_txn_id is not null;

create index if not exists orders_user_id_idx on public.orders (user_id);
create index if not exists orders_email_idx on public.orders (email);
create index if not exists orders_status_idx on public.orders (status);

-- ------------------------------------------------------------
-- Таблица subscriptions
-- ------------------------------------------------------------
create table if not exists public.subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  plan_type             plan_type not null,
  access_status         access_status not null default 'active',
  current_period_end    timestamptz not null,
  last_order_id         uuid references public.orders(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- один пользователь — одна активная подписка (для upsert по user_id)
  constraint subscriptions_user_id_unique unique (user_id)
);

create index if not exists subscriptions_access_status_idx on public.subscriptions (access_status);
create index if not exists subscriptions_period_end_idx on public.subscriptions (current_period_end);

-- ------------------------------------------------------------
-- Триггер: автоматически обновлять updated_at
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

drop trigger if exists trg_subscriptions_updated_at on public.subscriptions;
create trigger trg_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.orders enable row level security;
alter table public.subscriptions enable row level security;

-- --- orders ---------------------------------------------------
-- Пользователь видит только свои заказы
drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own"
  on public.orders
  for select
  using (auth.uid() = user_id);

-- Пользователь может создать заказ (pending) только на своё имя
drop policy if exists "orders_insert_own" on public.orders;
create policy "orders_insert_own"
  on public.orders
  for insert
  with check (auth.uid() = user_id);

-- Обновлять заказы с клиента нельзя вообще (только через service_role в Edge Function,
-- который RLS обходит по умолчанию). Явного UPDATE policy для anon/authenticated не создаём.

-- --- subscriptions ---------------------------------------------
-- Пользователь видит только свою подписку (нужно для Realtime-листенера в модалке)
drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own"
  on public.subscriptions
  for select
  using (auth.uid() = user_id);

-- INSERT/UPDATE с клиента запрещены — подписку меняет только kofi-webhook
-- (service_role key), который игнорирует RLS. Дополнительных policy не добавляем,
-- поэтому по умолчанию insert/update/delete для anon/authenticated заблокированы.

-- ------------------------------------------------------------
-- Публикация для Realtime (нужно, чтобы фронтенд мог подписаться на UPDATE)
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'subscriptions'
  ) then
    alter publication supabase_realtime add table public.subscriptions;
  end if;
end $$;

comment on table public.orders is 'Заказы, инициированные пользователем перед оплатой через Ko-fi';
comment on table public.subscriptions is 'Активные подписки пользователей, обновляются только через kofi-webhook (service_role)';

-- ============================================================
-- Безопасный поиск user_id по email (для kofi-webhook)
-- ============================================================
-- auth.users не должен быть напрямую доступен через PostgREST/anon-ключ.
-- Эта SECURITY DEFINER функция открывает только id по email, и вызывать
-- её могут исключительно service_role (Edge Function), а не клиенты.
create or replace function public.get_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke all on function public.get_user_id_by_email(text) from public;
revoke all on function public.get_user_id_by_email(text) from anon;
revoke all on function public.get_user_id_by_email(text) from authenticated;
grant execute on function public.get_user_id_by_email(text) to service_role;