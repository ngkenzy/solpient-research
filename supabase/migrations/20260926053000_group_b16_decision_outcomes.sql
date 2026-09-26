-- Group B / B16 — append-only decision outcome attribution.
-- Measures fixed-horizon close-price returns after a B15 decision and links the
-- UI back to existing Research, thesis-history, and What Matters evidence.
--
-- IMPORTANT: market_snapshots currently stores unadjusted daily close prices.
-- B16 therefore labels these results as close-price return, not total return.

create table if not exists public.decision_outcome_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  journal_entry_id uuid not null references public.position_decision_journal(id) on delete cascade,
  position_id uuid not null,
  company_id uuid not null references public.companies(id) on delete restrict,
  horizon text not null check (horizon in ('1d','1w','1m','3m','6m','1y')),
  horizon_target_at date not null,
  decision_market_snapshot_id uuid not null references public.market_snapshots(id) on delete restrict,
  decision_price numeric not null check (decision_price>0),
  decision_price_trading_date date not null,
  decision_price_provider text not null,
  observed_market_snapshot_id uuid not null references public.market_snapshots(id) on delete restrict,
  observed_price numeric not null check (observed_price>0),
  observed_trading_date date not null,
  observed_price_provider text not null,
  security_return_pct numeric not null,
  benchmark_ticker text not null,
  benchmark_decision_market_snapshot_id uuid null references public.market_snapshots(id) on delete restrict,
  benchmark_price_at_decision numeric null check (benchmark_price_at_decision is null or benchmark_price_at_decision>0),
  benchmark_decision_trading_date date null,
  benchmark_observed_market_snapshot_id uuid null references public.market_snapshots(id) on delete restrict,
  benchmark_price_at_observation numeric null check (benchmark_price_at_observation is null or benchmark_price_at_observation>0),
  benchmark_observed_trading_date date null,
  benchmark_return_pct numeric null,
  excess_return_pct numeric null,
  return_basis text not null default 'close_price_return_unadjusted'
    check (return_basis='close_price_return_unadjusted'),
  methodology_version text not null default 'group-b-decision-outcome-v1',
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint decision_outcome_position_owner_fkey
    foreign key (position_id,user_id)
    references public.portfolio_positions(id,user_id)
    on delete restrict,
  constraint decision_outcome_observation_after_anchor
    check (observed_trading_date>=decision_price_trading_date),
  constraint decision_outcome_unique_version
    unique (journal_entry_id,horizon,methodology_version)
);

create index if not exists decision_outcome_user_time_idx
  on public.decision_outcome_snapshots(user_id,captured_at desc);
create index if not exists decision_outcome_position_horizon_idx
  on public.decision_outcome_snapshots(position_id,horizon,captured_at desc);
create index if not exists decision_outcome_journal_idx
  on public.decision_outcome_snapshots(journal_entry_id,horizon);

alter table public.decision_outcome_snapshots enable row level security;

revoke all on public.decision_outcome_snapshots
  from public,anon,authenticated,service_role;
grant select on public.decision_outcome_snapshots to authenticated,service_role;

drop policy if exists "Users read own decision outcomes"
  on public.decision_outcome_snapshots;
create policy "Users read own decision outcomes"
on public.decision_outcome_snapshots for select
to authenticated
using ((select auth.uid())=user_id);

create or replace function private.guard_decision_outcome_snapshots_v1()
returns trigger
language plpgsql
set search_path=''
as $b16_guard$
begin
  if tg_op in ('UPDATE','DELETE')
     and current_user not in ('postgres','supabase_admin','supabase_auth_admin') then
    raise exception 'Decision outcome snapshots are append-only; create a new methodology version instead.';
  end if;

  if tg_op='DELETE' then return old; end if;
  return new;
end
$b16_guard$;

revoke all on function private.guard_decision_outcome_snapshots_v1()
  from public,anon,authenticated,service_role;

drop trigger if exists decision_outcome_snapshots_append_only_guard
  on public.decision_outcome_snapshots;
create trigger decision_outcome_snapshots_append_only_guard
before update or delete on public.decision_outcome_snapshots
for each row execute function private.guard_decision_outcome_snapshots_v1();

create or replace function consumer_private.refresh_decision_outcomes_batch_v1(
  p_limit integer default 500
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $b16_refresh$
declare
  v_limit integer:=least(greatest(coalesce(p_limit,500),1),5000);
  v_inserted integer:=0;
begin
  with candidates as (
    select
      d.id as journal_entry_id,
      d.user_id,
      d.position_id,
      d.company_id,
      d.decided_at,
      coalesce(nullif(rr.benchmark_ticker,''),'SPY') as benchmark_ticker,
      h.horizon,
      h.target_date
    from public.position_decision_journal d
    left join public.research_runs rr on rr.id=d.research_run_id
    cross join lateral (
      values
        ('1d'::text,d.decided_at::date+1),
        ('1w'::text,d.decided_at::date+7),
        ('1m'::text,(d.decided_at::date+interval '1 month')::date),
        ('3m'::text,(d.decided_at::date+interval '3 months')::date),
        ('6m'::text,(d.decided_at::date+interval '6 months')::date),
        ('1y'::text,(d.decided_at::date+interval '1 year')::date)
    ) h(horizon,target_date)
    where h.target_date<=current_date
      and not exists (
        select 1
        from public.decision_outcome_snapshots existing
        where existing.journal_entry_id=d.id
          and existing.horizon=h.horizon
          and existing.methodology_version='group-b-decision-outcome-v1'
      )
    order by d.decided_at,h.target_date,d.id
    limit v_limit
  ),
  anchored as (
    select
      c.*,
      security_anchor.id as decision_market_snapshot_id,
      security_anchor.trading_date as decision_price_trading_date,
      security_anchor.price as decision_price,
      security_anchor.provider as decision_price_provider,
      benchmark_anchor.id as benchmark_decision_market_snapshot_id,
      benchmark_anchor.trading_date as benchmark_decision_trading_date,
      benchmark_anchor.price as benchmark_price_at_decision
    from candidates c
    cross join lateral (
      select ms.id,ms.trading_date,ms.price,ms.provider,ms.observed_at
      from public.market_snapshots ms
      where ms.company_id=c.company_id
        and ms.trading_date<c.decided_at::date
        and ms.price>0
      order by
        ms.trading_date desc,
        case when ms.provider='yahoo-chart-history' then 0 else 1 end,
        ms.observed_at desc,
        ms.id
      limit 1
    ) security_anchor
    left join lateral (
      select ms.id,ms.trading_date,ms.price,ms.provider,ms.observed_at
      from public.market_snapshots ms
      where upper(ms.symbol)=upper(c.benchmark_ticker)
        and ms.trading_date<c.decided_at::date
        and ms.price>0
      order by
        ms.trading_date desc,
        case when ms.provider='yahoo-chart-history' then 0 else 1 end,
        ms.observed_at desc,
        ms.id
      limit 1
    ) benchmark_anchor on true
  ),
  observed as (
    select
      a.*,
      security_observed.id as observed_market_snapshot_id,
      security_observed.trading_date as observed_trading_date,
      security_observed.price as observed_price,
      security_observed.provider as observed_price_provider,
      benchmark_observed.id as benchmark_observed_market_snapshot_id,
      benchmark_observed.trading_date as benchmark_observed_trading_date,
      benchmark_observed.price as benchmark_price_at_observation
    from anchored a
    cross join lateral (
      select ms.id,ms.trading_date,ms.price,ms.provider,ms.observed_at
      from public.market_snapshots ms
      where ms.company_id=a.company_id
        and ms.trading_date>=a.target_date
        and ms.trading_date<=least(current_date,a.target_date+10)
        and ms.price>0
      order by
        ms.trading_date asc,
        case when ms.provider='yahoo-chart-history' then 0 else 1 end,
        ms.observed_at desc,
        ms.id
      limit 1
    ) security_observed
    left join lateral (
      select ms.id,ms.trading_date,ms.price,ms.provider,ms.observed_at
      from public.market_snapshots ms
      where upper(ms.symbol)=upper(a.benchmark_ticker)
        and ms.trading_date=security_observed.trading_date
        and ms.price>0
      order by
        case when ms.provider='yahoo-chart-history' then 0 else 1 end,
        ms.observed_at desc,
        ms.id
      limit 1
    ) benchmark_observed on true
  )
  insert into public.decision_outcome_snapshots(
    user_id,journal_entry_id,position_id,company_id,horizon,horizon_target_at,
    decision_market_snapshot_id,decision_price,decision_price_trading_date,decision_price_provider,
    observed_market_snapshot_id,observed_price,observed_trading_date,observed_price_provider,
    security_return_pct,benchmark_ticker,
    benchmark_decision_market_snapshot_id,benchmark_price_at_decision,benchmark_decision_trading_date,
    benchmark_observed_market_snapshot_id,benchmark_price_at_observation,benchmark_observed_trading_date,
    benchmark_return_pct,excess_return_pct,return_basis,methodology_version
  )
  select
    o.user_id,o.journal_entry_id,o.position_id,o.company_id,o.horizon,o.target_date,
    o.decision_market_snapshot_id,o.decision_price,o.decision_price_trading_date,o.decision_price_provider,
    o.observed_market_snapshot_id,o.observed_price,o.observed_trading_date,o.observed_price_provider,
    round(((o.observed_price/o.decision_price)-1)*100,8),
    o.benchmark_ticker,
    o.benchmark_decision_market_snapshot_id,o.benchmark_price_at_decision,o.benchmark_decision_trading_date,
    o.benchmark_observed_market_snapshot_id,o.benchmark_price_at_observation,o.benchmark_observed_trading_date,
    case
      when o.benchmark_price_at_decision is not null
       and o.benchmark_price_at_observation is not null
      then round(((o.benchmark_price_at_observation/o.benchmark_price_at_decision)-1)*100,8)
      else null
    end,
    case
      when o.benchmark_price_at_decision is not null
       and o.benchmark_price_at_observation is not null
      then round(
        (
          ((o.observed_price/o.decision_price)-1)
          -
          ((o.benchmark_price_at_observation/o.benchmark_price_at_decision)-1)
        )*100,
        8
      )
      else null
    end,
    'close_price_return_unadjusted',
    'group-b-decision-outcome-v1'
  from observed o
  on conflict (journal_entry_id,horizon,methodology_version) do nothing;

  get diagnostics v_inserted=row_count;

  return jsonb_build_object(
    'contract_version','group-b-decision-outcome-refresh-v1',
    'status','ok',
    'inserted',v_inserted,
    'methodology_version','group-b-decision-outcome-v1',
    'return_basis','close_price_return_unadjusted',
    'completed_at',now()
  );
end
$b16_refresh$;

revoke all on function consumer_private.refresh_decision_outcomes_batch_v1(integer)
  from public,anon,authenticated;
grant execute on function consumer_private.refresh_decision_outcomes_batch_v1(integer)
  to service_role;

create or replace function public.refresh_decision_outcomes_batch_v1(
  p_limit integer default 500
)
returns jsonb
language sql
volatile
security invoker
set search_path=''
as $$
  select consumer_private.refresh_decision_outcomes_batch_v1(p_limit);
$$;

revoke all on function public.refresh_decision_outcomes_batch_v1(integer)
  from public,anon,authenticated;
grant execute on function public.refresh_decision_outcomes_batch_v1(integer)
  to service_role;

comment on table public.decision_outcome_snapshots is
  'Group B16 append-only fixed-horizon outcome observations for user decisions. V1 measures unadjusted close-price return; it is not total return and does not score decisions as good or bad.';

comment on function public.refresh_decision_outcomes_batch_v1(integer) is
  'Group B16 service-role-only materializer. Uses the last close strictly before the decision date to avoid same-day look-ahead, then the first close on/after each fixed target horizon.';
