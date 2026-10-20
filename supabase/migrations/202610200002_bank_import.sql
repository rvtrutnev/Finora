-- Manual deployment required. This file was tested only against local PostgreSQL.
-- Each import RPC owns one transaction: same-owner requests serialize before
-- checking retry keys and possible matches. A file hash is not a bank identity.
-- Existing budget/category tables and their owner policies are prerequisites.
create table if not exists public.bank_import_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text not null check (type in ('expense','income')),
  match_type text not null check (match_type in ('description','mcc')),
  pattern text not null check (length(trim(pattern)) between 1 and 500),
  category text not null check (length(trim(category)) between 1 and 120),
  subcategory text not null default '',
  created_at timestamptz not null default now(),
  check (match_type <> 'mcc' or pattern ~ '^[0-9]{4}$')
);
alter table public.bank_import_rules enable row level security;
drop policy if exists bank_import_rules_owner on public.bank_import_rules;
create policy bank_import_rules_owner on public.bank_import_rules for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on public.bank_import_rules to authenticated;
revoke all on public.bank_import_rules from anon;

create table if not exists public.bank_import_keys (
  user_id uuid not null references auth.users(id) on delete cascade,
  import_key text not null check (length(import_key) between 66 and 300),
  file_hash text not null check (file_hash ~ '^[a-f0-9]{64}$'),
  source_id text not null check (length(source_id) between 1 and 150),
  operation_id text not null references public.budget_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, import_key),
  unique (operation_id)
);
alter table public.bank_import_keys enable row level security;
drop policy if exists bank_import_keys_owner on public.bank_import_keys;
create policy bank_import_keys_owner on public.bank_import_keys for select to authenticated using (auth.uid() = user_id);
revoke all on public.bank_import_keys from anon, authenticated;
grant select on public.bank_import_keys to authenticated;

-- Bounded definer: auth owner is derived internally, every lookup is scoped,
-- payload columns are allowlisted, fixed search_path and qualified relations.
create or replace function public.finora_import_add_category(p_type text,p_name text,p_expected_user_id uuid,p_subcategory text default '')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  owner_id uuid := auth.uid();
  category_row public.categories%rowtype;
  typed jsonb;
  item jsonb;
  idx integer := -1;
  pos integer := 0;
  subs jsonb;
begin
  if owner_id is null or owner_id is distinct from p_expected_user_id then raise exception 'Authentication changed'; end if;
  p_name := trim(p_name); p_subcategory := trim(coalesce(p_subcategory,''));
  if p_type not in ('expense','income') or p_type is null or p_name is null or length(p_name) not between 1 and 120 or length(p_subcategory)>120 then raise exception 'Invalid category payload'; end if;
  insert into public.categories(user_id,type,data) values(owner_id,'budget','{"expense":[],"income":[]}'::jsonb) on conflict(user_id) do nothing;
  select * into strict category_row from public.categories where user_id=owner_id for update;
  typed := coalesce(category_row.data->p_type,'[]'::jsonb);
  if jsonb_typeof(typed)<>'array' then raise exception 'Invalid category tree'; end if;
  for item in select value from jsonb_array_elements(typed) loop
    if item->>'name'=p_name then idx := pos; exit; end if;
    pos := pos+1;
  end loop;
  if idx<0 then
    typed := typed || jsonb_build_array(jsonb_build_object('name',p_name,'subcategories',case when p_subcategory='' then '[]'::jsonb else jsonb_build_array(p_subcategory) end));
  elsif p_subcategory<>'' then
    subs := coalesce(typed->idx->'subcategories','[]'::jsonb);
    -- Existing application stores strings; tolerate older named objects too.
    if not exists(select 1 from jsonb_array_elements(subs) s where s #>> '{}' = p_subcategory or s->>'name'=p_subcategory) then
      typed := jsonb_set(typed,array[idx::text,'subcategories'],subs||jsonb_build_array(p_subcategory));
    end if;
  end if;
  update public.categories set data=jsonb_set(category_row.data,array[p_type],typed) where id=category_row.id returning * into category_row;
  return to_jsonb(category_row);
end $$;

create or replace function public.finora_import_operation(p_expected_user_id uuid,p_import_key text,p_file_hash text,p_source_id text,p_operation jsonb,p_confirm_ambiguous boolean default false)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  owner_id uuid := auth.uid();
  saved public.budget_items%rowtype;
  tree jsonb;
  target jsonb;
  amount_value numeric;
  date_value date;
  note_value text;
  normalized_note text;
begin
  if owner_id is null or owner_id is distinct from p_expected_user_id then raise exception 'Authentication changed'; end if;
  if p_import_key is null or length(p_import_key) not between 66 and 300 or p_file_hash is null or p_file_hash !~ '^[a-f0-9]{64}$' or left(p_import_key,65)<>p_file_hash||':' or p_source_id is null or length(p_source_id) not between 1 and 150 then raise exception 'Invalid import identity'; end if;
  -- Serialize imports per owner, including different file hashes, preventing
  -- two simultaneous overlapping files from bypassing the ambiguous-match check.
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 9417));
  select b.* into saved from public.bank_import_keys k join public.budget_items b on b.id=k.operation_id and b.user_id=owner_id where k.user_id=owner_id and k.import_key=p_import_key;
  if found then return jsonb_build_object('status','existing','operation',to_jsonb(saved)); end if;
  if jsonb_typeof(p_operation)<>'object' or p_operation is null or (p_operation->>'type') not in ('expense','income') or p_operation->>'type' is null or coalesce(p_operation->>'category','')='' or (p_operation->>'currency') !~ '^[A-Z]{3}$' or p_operation->>'currency' is null then raise exception 'Invalid operation payload'; end if;
  amount_value := (p_operation->>'amount')::numeric;
  if amount_value is null or amount_value::text in ('NaN','Infinity','-Infinity') or amount_value<=0 or amount_value>90071992547409.91 or amount_value<>round(amount_value,2) then raise exception 'Invalid amount'; end if;
  if coalesce(p_operation->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid date'; end if;
  date_value := (p_operation->>'date')::date;
  if date_value<'1900-01-01'::date or date_value>'2200-12-31'::date then raise exception 'Invalid date'; end if;
  note_value := coalesce(p_operation->>'note','');
  if length(note_value)>10000 then raise exception 'Description too long'; end if;
  select data into tree from public.categories where user_id=owner_id for share;
  select value into target from jsonb_array_elements(coalesce(tree->(p_operation->>'type'),'[]'::jsonb)) where value->>'name'=p_operation->>'category' limit 1;
  if target is null then raise exception 'Target category no longer exists'; end if;
  if coalesce(p_operation->>'subcategory','')<>'' and not exists(select 1 from jsonb_array_elements(coalesce(target->'subcategories','[]'::jsonb)) s where s #>> '{}' = p_operation->>'subcategory' or s->>'name'=p_operation->>'subcategory') then raise exception 'Target subcategory no longer exists'; end if;
  normalized_note := lower(replace(regexp_replace(trim(note_value),'\s+',' ','g'),'ё','е'));
  if not coalesce(p_confirm_ambiguous,false) and exists (
    select 1 from public.budget_items b where b.user_id=owner_id and b.date=date_value and b.type=p_operation->>'type' and b.currency=p_operation->>'currency' and b.amount=amount_value
      and lower(replace(regexp_replace(trim(coalesce(b.note,'')),'\s+',' ','g'),'ё','е'))=normalized_note
      and not exists(select 1 from public.bank_import_keys k where k.user_id=owner_id and k.operation_id=b.id and k.file_hash=p_file_hash)
  ) then return jsonb_build_object('status','ambiguous'); end if;
  insert into public.budget_items(id,user_id,type,category,subcategory,amount,currency,date,note,recurring)
    values(gen_random_uuid()::text,owner_id,p_operation->>'type',p_operation->>'category',nullif(p_operation->>'subcategory',''),amount_value,p_operation->>'currency',date_value,note_value,false) returning * into saved;
  insert into public.bank_import_keys(user_id,import_key,file_hash,source_id,operation_id) values(owner_id,p_import_key,p_file_hash,p_source_id,saved.id);
  return jsonb_build_object('status','created','operation',to_jsonb(saved));
end $$;
revoke all on function public.finora_import_add_category(text,text,uuid,text) from public, anon;
revoke all on function public.finora_import_operation(uuid,text,text,text,jsonb,boolean) from public, anon;
grant execute on function public.finora_import_add_category(text,text,uuid,text) to authenticated;
grant execute on function public.finora_import_operation(uuid,text,text,text,jsonb,boolean) to authenticated;
