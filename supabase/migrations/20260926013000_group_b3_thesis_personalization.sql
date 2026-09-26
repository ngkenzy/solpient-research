-- Group B / B3 — user-owned thesis-factor personalization.
-- Canonical Research remains immutable. Users store only personal importance,
-- expectations, breaker notes, enabled state, and provenance references.

alter table public.portfolio_positions
  add constraint portfolio_positions_id_user_key unique (id,user_id);

create table if not exists public.position_thesis_factors (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('canonical','custom')),
  canonical_thesis_variable_id uuid null
    references public.thesis_variables(id) on delete restrict,
  factor_key text not null check (char_length(factor_key) between 1 and 220),
  factor_label text not null check (char_length(trim(factor_label)) between 1 and 240),
  importance smallint not null default 3 check (importance between 1 and 5),
  personal_expectation text null
    check (personal_expectation is null or char_length(personal_expectation) <= 2000),
  personal_breaker_condition text null
    check (personal_breaker_condition is null or char_length(personal_breaker_condition) <= 2000),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint position_thesis_factors_position_owner_fkey
    foreign key (position_id,user_id)
    references public.portfolio_positions(id,user_id)
    on delete cascade,
  constraint position_thesis_factors_position_key
    unique (position_id,factor_key)
);

create index if not exists position_thesis_factors_user_idx
  on public.position_thesis_factors(user_id,updated_at desc);

create index if not exists position_thesis_factors_position_idx
  on public.position_thesis_factors(position_id,enabled,importance desc);

create index if not exists position_thesis_factors_canonical_idx
  on public.position_thesis_factors(canonical_thesis_variable_id)
  where canonical_thesis_variable_id is not null;

create or replace function private.guard_position_thesis_factor_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_position_company_id uuid;
  v_thesis_company_id uuid;
  v_variable_name text;
  v_metric_key text;
  v_run_status text;
begin
  select pp.company_id
  into v_position_company_id
  from public.portfolio_positions pp
  where pp.id=new.position_id
    and pp.user_id=new.user_id;

  if v_position_company_id is null then
    raise exception 'Position ownership mismatch.'
      using errcode='23503';
  end if;

  if new.source_type='canonical' then
    if new.canonical_thesis_variable_id is null then
      raise exception 'Canonical thesis factor requires a thesis-variable reference.'
        using errcode='23514';
    end if;

    select rr.company_id,tv.variable_name,tv.metric_key,rr.status
    into v_thesis_company_id,v_variable_name,v_metric_key,v_run_status
    from public.thesis_variables tv
    join public.research_runs rr on rr.id=tv.research_run_id
    where tv.id=new.canonical_thesis_variable_id;

    if v_thesis_company_id is null then
      raise exception 'Unknown canonical thesis variable.'
        using errcode='23503';
    end if;

    if v_run_status<>'published' then
      raise exception 'Canonical thesis factor must reference published Research.'
        using errcode='23514';
    end if;

    if v_thesis_company_id<>v_position_company_id then
      raise exception 'Canonical thesis factor company does not match the position company.'
        using errcode='23514';
    end if;

    new.factor_key:='canonical:'||
      case
        when nullif(trim(coalesce(v_metric_key,'')),'') is not null
          then 'metric:'||lower(trim(v_metric_key))
        else 'variable:'||new.canonical_thesis_variable_id::text
      end;
    new.factor_label:=v_variable_name;
  else
    if new.canonical_thesis_variable_id is not null then
      raise exception 'Custom thesis factor cannot reference a canonical thesis variable.'
        using errcode='23514';
    end if;

    if nullif(trim(coalesce(new.factor_key,'')),'') is null
       or new.factor_key not like 'custom:%' then
      new.factor_key:='custom:'||gen_random_uuid()::text;
    end if;
  end if;

  new.updated_at:=now();
  return new;
end
$$;

revoke all on function private.guard_position_thesis_factor_v1()
  from public,anon,authenticated;

drop trigger if exists position_thesis_factors_guard
  on public.position_thesis_factors;
create trigger position_thesis_factors_guard
before insert or update on public.position_thesis_factors
for each row execute function private.guard_position_thesis_factor_v1();

drop trigger if exists position_thesis_factors_set_updated_at
  on public.position_thesis_factors;
create trigger position_thesis_factors_set_updated_at
before update on public.position_thesis_factors
for each row execute function private.set_consumer_updated_at_v1();

alter table public.position_thesis_factors enable row level security;

revoke all on public.position_thesis_factors from public,anon;
grant select,insert,update,delete on public.position_thesis_factors to authenticated;
grant all on public.position_thesis_factors to service_role;

drop policy if exists "Users read own thesis factors"
  on public.position_thesis_factors;
create policy "Users read own thesis factors"
on public.position_thesis_factors for select
to authenticated
using ((select auth.uid())=user_id);

drop policy if exists "Users insert own thesis factors"
  on public.position_thesis_factors;
create policy "Users insert own thesis factors"
on public.position_thesis_factors for insert
to authenticated
with check ((select auth.uid())=user_id);

drop policy if exists "Users update own thesis factors"
  on public.position_thesis_factors;
create policy "Users update own thesis factors"
on public.position_thesis_factors for update
to authenticated
using ((select auth.uid())=user_id)
with check ((select auth.uid())=user_id);

drop policy if exists "Users delete own thesis factors"
  on public.position_thesis_factors;
create policy "Users delete own thesis factors"
on public.position_thesis_factors for delete
to authenticated
using ((select auth.uid())=user_id);

comment on table public.position_thesis_factors is
  'Group B3 user-owned thesis personalization. Canonical Research is referenced, never modified.';

comment on function private.guard_position_thesis_factor_v1() is
  'Enforces position ownership and same-company published canonical thesis provenance for Group B3.';
