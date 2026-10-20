-- Local-only fixture mirroring inspected columns/constraints. Never apply to Supabase.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  type text not null,
  data jsonb not null,
  created_at timestamptz default now(),
  tags jsonb default '[]'::jsonb,
  unique (user_id)
);
create table public.budget_items (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id),
  type text not null,
  category text not null,
  subcategory text,
  amount numeric default 0,
  date date,
  note text,
  tag text,
  recurring boolean default false,
  recur_day integer,
  created_at timestamptz default now(),
  start_month text,
  currency text default 'RUB'
);
alter table public.categories enable row level security;
alter table public.budget_items enable row level security;
create policy owner on public.categories for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner on public.budget_items for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on public.categories, public.budget_items to authenticated;
insert into auth.users values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002');
