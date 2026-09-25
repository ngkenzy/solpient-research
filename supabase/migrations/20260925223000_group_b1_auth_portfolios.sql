-- Group B / B1 — consumer identity, portfolios, positions, and RLS.
-- User-owned data is isolated by auth.uid(); position ownership is also enforced
-- structurally through a composite portfolio/user foreign key.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text null check (display_name is null or char_length(display_name) between 1 and 120),
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'My Portfolio' check (char_length(trim(name)) between 1 and 120),
  is_default boolean not null default false,
  base_currency text not null default 'USD' check (base_currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create unique index if not exists portfolios_one_default_per_user_idx
  on public.portfolios(user_id)
  where is_default;

create index if not exists portfolios_user_idx
  on public.portfolios(user_id, created_at desc);

create table if not exists public.portfolio_positions (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete restrict,
  quantity numeric(24,8) not null check (quantity > 0),
  average_cost numeric(24,6) null check (average_cost is null or average_cost >= 0),
  opened_at date null,
  notes text null check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portfolio_positions_portfolio_owner_fkey
    foreign key (portfolio_id, user_id)
    references public.portfolios(id, user_id)
    on delete cascade,
  constraint portfolio_positions_portfolio_company_key
    unique (portfolio_id, company_id)
);

create index if not exists portfolio_positions_user_idx
  on public.portfolio_positions(user_id, created_at desc);

create index if not exists portfolio_positions_portfolio_idx
  on public.portfolio_positions(portfolio_id, created_at desc);

create index if not exists portfolio_positions_company_idx
  on public.portfolio_positions(company_id);

create schema if not exists private;

create or replace function private.set_consumer_updated_at_v1()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

revoke all on function private.set_consumer_updated_at_v1() from public, anon;
grant execute on function private.set_consumer_updated_at_v1() to authenticated, service_role;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_consumer_updated_at_v1();

drop trigger if exists portfolios_set_updated_at on public.portfolios;
create trigger portfolios_set_updated_at
before update on public.portfolios
for each row execute function private.set_consumer_updated_at_v1();

drop trigger if exists portfolio_positions_set_updated_at on public.portfolio_positions;
create trigger portfolio_positions_set_updated_at
before update on public.portfolio_positions
for each row execute function private.set_consumer_updated_at_v1();

create or replace function private.handle_consumer_user_created_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_display_name text;
begin
  v_display_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');

  insert into public.profiles(user_id, display_name)
  values (new.id, v_display_name)
  on conflict (user_id) do nothing;

  insert into public.portfolios(user_id, name, is_default, base_currency)
  values (new.id, 'My Portfolio', true, 'USD')
  on conflict do nothing;

  return new;
end
$$;

revoke all on function private.handle_consumer_user_created_v1() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_group_b1 on auth.users;
create trigger on_auth_user_created_group_b1
after insert on auth.users
for each row execute function private.handle_consumer_user_created_v1();

-- Backfill defensively if Auth users exist before this migration.
insert into public.profiles(user_id, display_name)
select
  u.id,
  nullif(trim(coalesce(u.raw_user_meta_data ->> 'display_name', '')), '')
from auth.users u
on conflict (user_id) do nothing;

insert into public.portfolios(user_id, name, is_default, base_currency)
select u.id, 'My Portfolio', true, 'USD'
from auth.users u
where not exists (
  select 1
  from public.portfolios p
  where p.user_id=u.id
)
on conflict do nothing;

alter table public.profiles enable row level security;
alter table public.portfolios enable row level security;
alter table public.portfolio_positions enable row level security;

revoke all on public.profiles from public, anon;
revoke all on public.portfolios from public, anon;
revoke all on public.portfolio_positions from public, anon;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.portfolios to authenticated;
grant select, insert, update, delete on public.portfolio_positions to authenticated;

grant all on public.profiles to service_role;
grant all on public.portfolios to service_role;
grant all on public.portfolio_positions to service_role;

drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile"
on public.profiles for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users insert own profile" on public.profiles;
create policy "Users insert own profile"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users read own portfolios" on public.portfolios;
create policy "Users read own portfolios"
on public.portfolios for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users insert own portfolios" on public.portfolios;
create policy "Users insert own portfolios"
on public.portfolios for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own portfolios" on public.portfolios;
create policy "Users update own portfolios"
on public.portfolios for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete own portfolios" on public.portfolios;
create policy "Users delete own portfolios"
on public.portfolios for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users read own positions" on public.portfolio_positions;
create policy "Users read own positions"
on public.portfolio_positions for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users insert own positions" on public.portfolio_positions;
create policy "Users insert own positions"
on public.portfolio_positions for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own positions" on public.portfolio_positions;
create policy "Users update own positions"
on public.portfolio_positions for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete own positions" on public.portfolio_positions;
create policy "Users delete own positions"
on public.portfolio_positions for delete
to authenticated
using ((select auth.uid()) = user_id);

comment on table public.profiles is
  'Group B consumer profile keyed one-to-one to auth.users. Authorization is always auth.uid()-based.';

comment on table public.portfolios is
  'Group B user-owned manual investment portfolios. No brokerage connection is implied.';

comment on table public.portfolio_positions is
  'Group B user-owned manual company positions tied to canonical SOLPIENT companies and portfolio ownership.';
