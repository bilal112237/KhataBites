-- ============================================================================
-- QUICK CLOUD SYNC TABLE (Run this in Supabase SQL Editor for instant sync)
-- ============================================================================
create table if not exists public.khata_cloud_store (
  room_key text primary key,
  payload jsonb not null,
  updated_at timestamptz default now()
);

alter table public.khata_cloud_store enable row level security;

create policy "Allow public squad sync"
  on public.khata_cloud_store
  for all
  using (true)
  with check (true);
