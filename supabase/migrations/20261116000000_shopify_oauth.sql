-- Shopify OAuth connections (tokens are stored AES-256-GCM encrypted; access only via service role)
create table if not exists public.shopify_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  shop_domain text not null unique,
  access_token_enc text,
  refresh_token_enc text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scopes text,
  status text not null default 'active' check (status in ('active', 'disconnected')),
  sync_status text not null default 'pending' check (sync_status in ('pending', 'running', 'done', 'error', 'idle')),
  last_sync_at timestamptz,
  refresh_lock_until timestamptz,
  installed_at timestamptz not null default now(),
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shopify_connections_user_idx on public.shopify_connections (user_id);

-- RLS on, NO policies: only the service role (API routes / sync scripts) can read tokens.
alter table public.shopify_connections enable row level security;

-- Audit log for mandatory compliance webhooks (also used for idempotency by webhook id)
create table if not exists public.shopify_compliance_requests (
  id uuid primary key default gen_random_uuid(),
  webhook_id text unique,
  topic text not null,
  shop_domain text not null,
  payload jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.shopify_compliance_requests enable row level security;