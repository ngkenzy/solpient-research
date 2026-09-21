-- Phase 2 provenance hardening: frozen public historical read model + advisor fixes.

create table if not exists public.research_public_history_items (
  id uuid primary key default gen_random_uuid(),
  research_run_id uuid not null references public.research_runs(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  module text not null,
  metric_key text not null,
  value_numeric numeric,
  unit text,
  economic_period_end date,
  economic_period_type text,
  known_at timestamptz not null,
  source_confidence_class text,
  conflict_state text,
  created_at timestamptz not null default now(),
  constraint research_public_history_items_unique
    unique(research_run_id,module,metric_key,economic_period_end,economic_period_type,known_at)
);

create index if not exists research_public_history_items_run_idx
  on public.research_public_history_items(research_run_id,module,metric_key,economic_period_end);
create index if not exists research_public_history_items_company_idx
  on public.research_public_history_items(company_id,research_run_id);

alter table public.research_public_history_items enable row level security;
grant select on public.research_public_history_items to anon,authenticated;
grant all on public.research_public_history_items to service_role;

drop policy if exists "public read frozen research history" on public.research_public_history_items;
create policy "public read frozen research history"
on public.research_public_history_items for select
to anon,authenticated
using (
  exists (
    select 1 from public.research_runs rr
    where rr.id=research_run_id and rr.status='published'
  )
);

drop trigger if exists research_public_history_items_append_only_guard
  on public.research_public_history_items;
create trigger research_public_history_items_append_only_guard
before update or delete on public.research_public_history_items
for each row execute function private.guard_append_only_history();

create or replace function private.freeze_public_research_history()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_cutoff timestamptz;
begin
  if new.status<>'published' then return new; end if;
  v_cutoff:=coalesce(new.data_cutoff_at,new.researched_at);
  if v_cutoff is null then return new; end if;

  insert into public.research_public_history_items(
    research_run_id,company_id,module,metric_key,value_numeric,unit,
    economic_period_end,economic_period_type,known_at,
    source_confidence_class,conflict_state,created_at
  )
  select
    new.id,nf.company_id,nf.module,nf.metric_key,nf.value_numeric,nf.unit,
    nf.economic_period_end,nf.economic_period_type,nf.known_at,
    nf.source_confidence_class,nf.conflict_state,coalesce(new.published_at,now())
  from public.normalized_facts nf
  where nf.company_id=new.company_id
    and nf.known_at<=v_cutoff
    and nf.conflict_state<>'superseded'
    and (
      (nf.module='universal' and nf.metric_key in (
        'revenue','free_cash_flow','gross_margin','operating_margin','fcf_margin',
        'eps_diluted','fcf_per_share','shares_outstanding','dividends_paid','buybacks',
        'stock_based_compensation','acquisitions','debt_issued','debt_repaid'
      ))
      or (nf.module='valuation_history' and nf.metric_key in (
        'pe','forward_pe','price_to_fcf','fcf_yield'
      ))
      or (nf.module='capital_allocation' and nf.metric_key in (
        'dividends_paid','buybacks','stock_based_compensation','acquisitions',
        'debt_issued','debt_repaid','ending_share_count'
      ))
      or (nf.module like 'peer:%' and nf.metric_key in (
        'revenue_growth_yoy','fcf_margin','price_to_fcf','fcf_yield'
      ))
    )
    and not exists (
      select 1
      from public.normalized_facts newer
      where newer.supersedes_fact_id=nf.id
        and newer.known_at<=v_cutoff
    )
  on conflict do nothing;

  return new;
end $$;

revoke all on function private.freeze_public_research_history() from public,anon,authenticated;

drop trigger if exists zz_research_runs_public_history_freeze on public.research_runs;
create trigger zz_research_runs_public_history_freeze
after insert on public.research_runs
for each row execute function private.freeze_public_research_history();

revoke all on function public.get_public_research_history_as_of_v1(uuid)
  from public,anon,authenticated;
drop function if exists public.get_public_research_history_as_of_v1(uuid);

drop policy if exists "deny public evidence sources" on public.evidence_sources;
create policy "deny public evidence sources"
on public.evidence_sources for select to anon,authenticated using(false);

drop policy if exists "deny public evidence observations" on public.evidence_observations;
create policy "deny public evidence observations"
on public.evidence_observations for select to anon,authenticated using(false);

drop policy if exists "deny public normalized facts" on public.normalized_facts;
create policy "deny public normalized facts"
on public.normalized_facts for select to anon,authenticated using(false);

drop policy if exists "deny public normalized fact observations" on public.normalized_fact_observations;
create policy "deny public normalized fact observations"
on public.normalized_fact_observations for select to anon,authenticated using(false);

drop policy if exists "deny public normalized fact inputs" on public.normalized_fact_inputs;
create policy "deny public normalized fact inputs"
on public.normalized_fact_inputs for select to anon,authenticated using(false);

drop policy if exists "deny public resolution decisions" on public.evidence_resolution_decisions;
create policy "deny public resolution decisions"
on public.evidence_resolution_decisions for select to anon,authenticated using(false);

drop policy if exists "deny public manifest staging" on public.research_input_manifest_staging;
create policy "deny public manifest staging"
on public.research_input_manifest_staging for select to anon,authenticated using(false);

create index if not exists evidence_resolution_selected_observation_idx
  on public.evidence_resolution_decisions(selected_observation_id);
create index if not exists research_input_manifest_staging_company_idx
  on public.research_input_manifest_staging(company_id);
create index if not exists research_input_manifest_staging_composition_idx
  on public.research_input_manifest_staging(composition_id);
create index if not exists research_input_manifest_staging_context_idx
  on public.research_input_manifest_staging(context_pack_id);
create index if not exists research_input_manifests_company_idx
  on public.research_input_manifests(company_id);
create index if not exists research_input_manifests_context_idx
  on public.research_input_manifests(context_pack_id);

comment on table public.research_public_history_items is
  'Immutable sanitized historical values frozen per published research run for public rendering.';
