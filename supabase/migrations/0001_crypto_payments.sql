-- ============================================================
-- Crypto (Polygon) payment reconciliation schema
-- ============================================================

-- --- users: подписка -------------------------------------------------
alter table public.users
  add column if not exists has_active_subscription boolean not null default false,
  add column if not exists subscription_expires_at timestamptz;

-- --- orders ------------------------------------------------------------
-- exact_amount хранится в ЦЕНТАХ (integer), а не в float.
-- Никогда не сравнивайте деньги через float/numeric с плавающей запятой —
-- 99.02 в JS/Postgres может не совпасть с 99.02 из блокчейна из-за
-- округления при конвертации Wei -> decimal. Целые центы решают это раз и навсегда.

create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  base_amount_cents integer not null,                 -- цена товара, напр. 9900 (=$99.00)
  cents_offset      smallint not null,                 -- 0..99, уникальный "хвост" для идентификации
  exact_amount_cents integer generated always as (base_amount_cents + cents_offset) stored,
  status            text not null default 'pending'
                       check (status in ('pending','success','expired','fraud_flagged')),
  tx_hash           text,                               -- заполняется при успехе
  chain             text not null default 'polygon',
  token             text not null default 'USDC',       -- какой токен ждём
  receiving_wallet  text not null,                       -- адрес, на который должны перевести
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '30 minutes'),
  matched_at        timestamptz,
  tx_block_time     timestamptz                          -- время самой транзакции в блокчейне
);

-- Анти-фрод: один и тот же tx_hash нельзя засчитать дважды НИ ПРИ КАКИХ условиях.
create unique index if not exists orders_tx_hash_unique
  on public.orders (tx_hash)
  where tx_hash is not null;

-- Пока заказ 'pending', пара (сумма, статус) должна быть уникальна —
-- это и есть "пул центов": нельзя выдать одинаковую exact_amount_cents
-- двум одновременно висящим pending-заказам.
create unique index if not exists orders_pending_amount_unique
  on public.orders (exact_amount_cents)
  where status = 'pending';

create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_amount_idx on public.orders (exact_amount_cents);

alter table public.orders enable row level security;

-- Пользователь видит только свои заказы, изменять напрямую не может —
-- все мутации идут через service_role в Edge Functions.
create policy "orders_select_own" on public.orders
  for select using (auth.uid() = user_id);

-- Realtime: включаем стриминг изменений по этой таблице,
-- фронт подписывается на конкретный order.id и сам закрывает модалку
-- когда status меняется на 'success' (никакого ручного websocket-кода не нужно).
alter publication supabase_realtime add table public.orders;

-- --- unmatched_payments -------------------------------------------------
-- Если деньги пришли, а подходящего pending-заказа не нашлось (просрочка,
-- опечатка суммы, ручной перевод) — не теряем их молча, а складываем сюда
-- для ручного разбора/возврата.
create table if not exists public.unmatched_payments (
  id           uuid primary key default gen_random_uuid(),
  tx_hash      text not null unique,
  amount_cents integer not null,
  token        text,
  raw_activity jsonb,
  created_at   timestamptz not null default now(),
  resolved     boolean not null default false
);

alter table public.unmatched_payments enable row level security;
-- Никаких публичных policy — доступ только через service_role (Edge Functions / дашборд).

