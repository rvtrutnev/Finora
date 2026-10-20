-- Apply once in Supabase SQL Editor before publishing the new frontend.
-- Existing wallets, budgets, categories and account settings are unchanged.
begin;

create table public.irregular_payments (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null check (id ~ '^[a-zA-Z0-9_-]{1,64}$'),
  name text not null check (length(trim(name)) between 1 and 100),
  amount numeric(12,2) not null check (amount > 0 and amount <= 1000000000),
  currency text not null check (currency in ('RUB', 'USD', 'EUR')),
  months integer not null check (months between 2 and 120),
  start_month text not null check (start_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.irregular_payments enable row level security;
revoke all on public.irregular_payments from anon;
grant select, insert, update, delete on public.irregular_payments to authenticated;
create policy "Account owner manages irregular payments"
  on public.irregular_payments for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

commit;
