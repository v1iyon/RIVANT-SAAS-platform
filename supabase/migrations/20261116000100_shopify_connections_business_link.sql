-- Link OAuth connections to RIVANT business + integrations row (run after 20261116000000)
alter table public.shopify_connections
  add column if not exists business_id uuid references public.businesses(id) on delete cascade,
  add column if not exists integration_id uuid references public.integrations(id) on delete set null;

create index if not exists shopify_connections_business_idx on public.shopify_connections (business_id);