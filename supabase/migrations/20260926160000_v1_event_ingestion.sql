-- V1 Event Ingestion — PRD Build 4 (the big rock).
--
-- The materiality engine previously only diffed research snapshots, so six of
-- the PRD §15 event categories (guidance, management, regulatory, competition,
-- capital allocation, business) could never fire. This migration adds the
-- schema for real-world event ingestion upstream of the change engine:
--
-- 1. `event_taxonomy` — versioned rows seeding PRD §15's 8 categories
--    (the 6 new ones plus the 2 the change engine already covers: financial,
--    research). Rows carry taxonomy_version / effective_from / effective_to /
--    superseded_by so a future taxonomy revision can supersede rows without
--    rewriting history.
-- 2. `company_change_events.category` is constrained to the taxonomy via FK.
--    Legacy free-text categories are remapped safely first
--    (market/valuation/return/consensus/financial/score/coverage -> financial;
--    thesis/filing/research -> research); any unmapped value aborts loudly.
-- 3. New per-event columns: `confidence` (0-100 deterministic heuristic),
--    `knowledge_time` (when the world knew), `disclosure_time` (when Solpient
--    ingested), `affected_fact_id` (FK to the normalized fact the event bears
--    on, when known), `event_source` (detector provenance), `event_taxonomy`
--    (taxonomy version at classification time). knowledge_time <= disclosure_time
--    is enforced.
-- 4. `materiality_assessments` (Stage A, company-level: severity, confidence,
--    explanation, methodology_version) and `user_materiality_assessments`
--    (Stage B, owner-scoped: score, level, position_weight, thesis_relevance,
--    display_priority, methodology_version).
--
-- Design choice (documented): we create the two assessment tables instead of
-- extending `intelligence_events` / `thesis_alerts`. `intelligence_events` is
-- the research-side normalization sink (filings, capital activity, research
-- changes) with its own review_status workflow and (source_kind, source_id)
-- keying; grafting Stage A/B assessment semantics onto it would couple the
-- consumer materiality pipeline to the research inbox. `thesis_alerts` is the
-- alert-delivery layer materialized from the What Matters contract, not the
-- audit-grade assessment input. Two small tables with explicit FKs keep the
-- provenance chain event -> company assessment -> user assessment intact.
--
-- 5. Deterministic Stage A / Stage B functions (no LLM anywhere in the path):
--      consumer_private.assess_company_event_materiality_v1(p_event_id)
--      public.assess_company_event_materiality_v1(p_company_change_event_id)
--        [service_role only; thin wrapper because PostgREST exposes only the
--        public schema — the ingestion worker calls this after inserting events]
--      consumer_private.assess_company_events_since_v1(p_since)
--      public.assess_company_events_since_v1(p_since)
--        [service_role only; batch/repair entrypoint for events that missed
--        per-event assessment, e.g. backfilled rows]
--      consumer_private.refresh_user_materiality_assessments_v1(p_since)
--      public.refresh_my_materiality_assessments_v1(p_since)  [authenticated]
--    Stage B scoring mirrors PR #137's weight-aware
--    `get_my_what_matters_v1` exactly (position_weight multiplicand,
--    equal-weight fallback, follow = neutral 1.0) and stays on methodology
--    `group-b-user-materiality-v2`.
-- 6. `consumer_private.get_company_materiality_events_v1` now prefers the
--    persisted Stage A assessment (severity, confidence, explanation,
--    methodology `group-b-event-materiality-v1`) and falls back to the legacy
--    v1 mapping for unassessed rows. Events assessed `not_material` are
--    excluded from the contract (they were reviewed and dismissed; the
--    assessment row is the quiet-state audit trail).
--
-- Visibility model: event_taxonomy and materiality_assessments are
-- company/reference-level, so they follow the company_change_events model
-- (public select, service_role write) — consistent with the data they
-- describe. user_materiality_assessments is strictly owner-scoped
-- (auth.uid() = user_id); no cross-user reads.
--
-- Deterministic; methodology_version on everything; no secrets.

-- ---------------------------------------------------------------------------
-- 1. Event taxonomy (versioned reference rows, PRD §15).
-- ---------------------------------------------------------------------------

create table if not exists public.event_taxonomy (
  category_key text primary key,
  category_name text not null,
  description text not null,
  sub_types text[] not null default '{}',
  taxonomy_version text not null default 'event-taxonomy-v1',
  effective_from timestamptz not null default now(),
  effective_to timestamptz null,
  superseded_by text null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  constraint event_taxonomy_effective_window_check
    check (effective_to is null or effective_to > effective_from)
);

comment on table public.event_taxonomy is
  'Versioned event taxonomy (PRD §15). category_key is the stable join key; taxonomy_version/effective_from/effective_to/superseded_by track revisions without rewriting history.';

insert into public.event_taxonomy(
  category_key,category_name,description,sub_types,taxonomy_version,sort_order
) values
(
  'financial','Financial',
  'Company financial state and performance: revenue, margins, EPS, cash flow, leverage, liquidity, share count. Includes snapshot-diff detections from the change engine.',
  array['revenue','revenue growth','margins','EPS','FCF','FCF margin','leverage','liquidity','share count'],
  'event-taxonomy-v1',1
),
(
  'guidance','Guidance',
  'Management guidance changes: raised, maintained, lowered, withdrawn, or new guidance.',
  array['raised','maintained','lowered','withdrawn','new guidance'],
  'event-taxonomy-v1',2
),
(
  'business','Business',
  'Operating business developments: major customers and contracts, product launches, pricing, demand, market share, geographic expansion, supply chain.',
  array['major customer','product launch','pricing','demand','market share','geographic expansion','supply chain'],
  'event-taxonomy-v1',3
),
(
  'competition','Competition',
  'Competitive landscape moves: new entrants, competing products, price changes, technological disruption.',
  array['new entrant','competing product','price changes','technological disruption'],
  'event-taxonomy-v1',4
),
(
  'capital_allocation','Capital Allocation',
  'Capital allocation actions: acquisitions, divestitures, buybacks, dilution, dividends, debt issuance and repayment.',
  array['acquisition','divestiture','buyback','dilution','dividend','debt issuance','debt repayment'],
  'event-taxonomy-v1',5
),
(
  'management','Management',
  'Management changes: CEO, CFO, board, and other material executive changes.',
  array['CEO','CFO','board','material executive change'],
  'event-taxonomy-v1',6
),
(
  'regulatory','Regulatory',
  'Regulatory actions: investigations, approvals, rejections, rule changes, litigation.',
  array['investigation','approval','rejection','rule change','litigation'],
  'event-taxonomy-v1',7
),
(
  'research','Research',
  'Research-pipeline observations: valuation changes, thesis status changes, risk changes, research version changes, and new filings detected by the change engine.',
  array['valuation change','thesis status change','risk change','research version change','new filing'],
  'event-taxonomy-v1',8
)
on conflict (category_key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Constrain company_change_events.category to the taxonomy.
--    Legacy free-text values are remapped first; anything unmapped aborts.
-- ---------------------------------------------------------------------------

update public.company_change_events
set category='financial'
where category in ('market','valuation','return','consensus','financial','score','coverage');

update public.company_change_events
set category='research'
where category in ('thesis','filing','research');

do $v1_taxonomy_guard$
declare
  v_left text;
begin
  select string_agg(distinct category,', ') into v_left
  from public.company_change_events
  where category not in (select category_key from public.event_taxonomy);

  if v_left is not null then
    raise exception
      'v1_event_ingestion: unmapped company_change_events categories cannot be constrained to event_taxonomy: %',
      v_left;
  end if;
end
$v1_taxonomy_guard$;

alter table public.company_change_events
  drop constraint if exists company_change_events_category_taxonomy_fkey;

alter table public.company_change_events
  add constraint company_change_events_category_taxonomy_fkey
  foreign key (category) references public.event_taxonomy(category_key);

-- ---------------------------------------------------------------------------
-- 3. Per-event ingestion columns: confidence, knowledge/disclosure time,
--    affected-fact link.
-- ---------------------------------------------------------------------------

alter table public.company_change_events
  add column if not exists confidence integer null
    check (confidence is null or (confidence >= 0 and confidence <= 100)),
  add column if not exists knowledge_time timestamptz null,
  add column if not exists disclosure_time timestamptz null,
  add column if not exists affected_fact_id uuid null
    references public.normalized_facts(id) on delete set null,
  add column if not exists event_source text null,
  add column if not exists event_taxonomy text null,
  add column if not exists evidence_payload jsonb null;

alter table public.company_change_events
  drop constraint if exists company_change_events_knowledge_before_disclosure_check;

alter table public.company_change_events
  add constraint company_change_events_knowledge_before_disclosure_check
  check (
    knowledge_time is null
    or disclosure_time is null
    or knowledge_time <= disclosure_time
  );

create index if not exists company_change_events_affected_fact_idx
  on public.company_change_events(affected_fact_id);

comment on column public.company_change_events.confidence is
  'V1 event ingestion: deterministic 0-100 confidence heuristic for the event classification (source reliability + keyword corroboration). Null for legacy rows.';
comment on column public.company_change_events.knowledge_time is
  'V1 event ingestion: when the world knew (e.g. SEC filing accepted time, press-release timestamp).';
comment on column public.company_change_events.disclosure_time is
  'V1 event ingestion: when Solpient ingested the event (detector run time).';
comment on column public.company_change_events.affected_fact_id is
  'V1 event ingestion: the normalized fact the event bears on, when a deterministic match exists.';
comment on column public.company_change_events.event_source is
  'V1 event ingestion: detector that produced the event (e.g. sec-8k-detector-v1, sec-companyfacts-detector-v1). Null for legacy rows.';
comment on column public.company_change_events.event_taxonomy is
  'V1 event ingestion: taxonomy version the event was classified under (e.g. event-taxonomy-v1). Null for legacy rows.';
comment on column public.company_change_events.evidence_payload is
  'V1 event ingestion: detector evidence — label, summary, confidence, event key, filing metadata, and the exact matched keywords that drove the classification. Null for legacy rows.';

-- ---------------------------------------------------------------------------
-- 4. Stage A: company materiality assessments (incl. explicit not_material).
-- ---------------------------------------------------------------------------

create table if not exists public.materiality_assessments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null
    references public.company_change_events(id) on delete cascade,
  severity text not null
    check (severity in ('not_material','notable','material','high')),
  confidence integer not null
    check (confidence between 0 and 100),
  explanation text not null
    check (char_length(explanation) between 1 and 2000),
  methodology_version text not null default 'group-b-event-materiality-v1',
  assessed_at timestamptz not null default now(),
  assessor text not null default 'deterministic-engine',
  created_at timestamptz not null default now(),
  constraint materiality_assessments_event_methodology_key
    unique (event_id,methodology_version)
);

create index if not exists materiality_assessments_event_idx
  on public.materiality_assessments(event_id,assessed_at desc);

comment on table public.materiality_assessments is
  'Stage A company materiality: deterministic, versioned assessment per classified event. not_material rows are the explicit "reviewed and dismissed" audit trail.';

-- ---------------------------------------------------------------------------
-- 5. Stage B: user materiality assessments (owner-scoped).
-- ---------------------------------------------------------------------------

create table if not exists public.user_materiality_assessments (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null
    references public.materiality_assessments(id) on delete cascade,
  user_id uuid not null
    references auth.users(id) on delete cascade,
  position_id uuid not null,
  score integer not null
    check (score between 0 and 100),
  level text not null
    check (level in ('thesis_priority','important','monitor','background')),
  position_weight numeric null
    check (position_weight is null or (position_weight >= 0 and position_weight <= 1)),
  thesis_relevance numeric null,
  display_priority integer not null default 0,
  methodology_version text not null default 'group-b-user-materiality-v2',
  assessed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint user_materiality_assessments_assessment_user_position_key
    unique (assessment_id,user_id,position_id),
  constraint user_materiality_assessments_position_owner_fkey
    foreign key (position_id,user_id)
    references public.portfolio_positions(id,user_id)
    on delete cascade
);

create index if not exists user_materiality_assessments_user_score_idx
  on public.user_materiality_assessments(user_id,score desc,assessed_at desc);

create index if not exists user_materiality_assessments_position_idx
  on public.user_materiality_assessments(position_id,assessed_at desc);

comment on table public.user_materiality_assessments is
  'Stage B user materiality: persisted, owner-scoped mirror of the weight-aware What Matters scoring (group-b-user-materiality-v2). Written by the pipeline via service_role; users read only their own rows.';

-- ---------------------------------------------------------------------------
-- 6. RLS.
-- ---------------------------------------------------------------------------

alter table public.event_taxonomy enable row level security;
alter table public.materiality_assessments enable row level security;
alter table public.user_materiality_assessments enable row level security;

revoke all on public.event_taxonomy from public,anon,authenticated;
revoke all on public.materiality_assessments from public,anon,authenticated;
revoke all on public.user_materiality_assessments from public,anon,authenticated;

grant select on public.event_taxonomy to anon,authenticated;
grant select,insert,update,delete on public.event_taxonomy to service_role;

grant select on public.materiality_assessments to anon,authenticated;
grant select,insert,update,delete on public.materiality_assessments to service_role;

grant select on public.user_materiality_assessments to authenticated;
grant select,insert,update,delete on public.user_materiality_assessments to service_role;

-- The service-role-only Stage A wrapper resolves consumer_private at call
-- time as the invoking role. Grant USAGE explicitly (authenticated already
-- holds it via the existing consumer grants).
grant usage on schema consumer_private to service_role;

drop policy if exists "public read event taxonomy" on public.event_taxonomy;
create policy "public read event taxonomy"
on public.event_taxonomy for select
to anon,authenticated using (true);

drop policy if exists "service role manages event taxonomy"
on public.event_taxonomy;
create policy "service role manages event taxonomy"
on public.event_taxonomy for all
to service_role using (true) with check (true);

drop policy if exists "public read materiality assessments"
on public.materiality_assessments;
create policy "public read materiality assessments"
on public.materiality_assessments for select
to anon,authenticated using (true);

drop policy if exists "service role manages materiality assessments"
on public.materiality_assessments;
create policy "service role manages materiality assessments"
on public.materiality_assessments for all
to service_role using (true) with check (true);

drop policy if exists "users read own materiality assessments"
on public.user_materiality_assessments;
create policy "users read own materiality assessments"
on public.user_materiality_assessments for select
to authenticated
using ((select auth.uid())=user_id);

-- ---------------------------------------------------------------------------
-- 7. Stage A engine: deterministic assessment of one classified event.
-- ---------------------------------------------------------------------------
--
-- Public service-role-only wrapper for the Stage A assessment.
--
-- PostgREST only exposes the public schema, so a server worker (service role)
-- cannot call consumer_private functions through the REST/RPC surface. This
-- thin wrapper exists so scripts/ingest-company-events.mjs can trigger the
-- deterministic Stage A assessment after inserting events. It is revoked from
-- every role except service_role: there is no authenticated path.

create or replace function public.assess_company_event_materiality_v1(
  p_company_change_event_id uuid
)
returns void
language sql
security invoker
set search_path=consumer_private,public,pg_temp
as $$
  select consumer_private.assess_company_event_materiality_v1(p_company_change_event_id);
$$;

revoke all on function public.assess_company_event_materiality_v1(uuid)
  from public,anon,authenticated;
grant execute on function public.assess_company_event_materiality_v1(uuid)
  to service_role;

comment on function public.assess_company_event_materiality_v1(uuid) is
  'SOLPIENT V1 event ingestion (service-role only). Server worker entry point for the '
  'deterministic Stage A company-level materiality assessment '
  '(methodology group-b-event-materiality-v1). Revoked from anon/authenticated.';

create or replace function consumer_private.assess_company_event_materiality_v1(
  p_event_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_event public.company_change_events%rowtype;
  v_severity text;
  v_confidence integer;
  v_explanation text;
  v_assessment_id uuid;
  c_methodology constant text:='group-b-event-materiality-v1';
begin
  select * into v_event
  from public.company_change_events
  where id=p_event_id;

  if not found then
    raise exception 'Unknown company_change_event %.',p_event_id;
  end if;

  -- The detector already applied the deterministic classification rules; Stage A
  -- records the severity, applies the low-confidence cap, and persists the
  -- versioned audit row (including explicit not_material).
  v_severity:=case v_event.materiality
    when 'high' then 'high'
    when 'material' then 'material'
    when 'notable' then 'notable'
    when 'not_material' then 'not_material'
    else 'notable'
  end;

  v_confidence:=coalesce(
    v_event.confidence,
    case v_event.source_kind
      when 'sec-filing' then 85
      when 'filing' then 85
      when 'press' then 80
      when 'research' then 75
      else 70
    end
  );

  -- A low-confidence classification can never stay 'high'.
  if v_confidence < 40 and v_severity='high' then
    v_severity:='notable';
  end if;

  v_explanation:=left(
    'Stage A deterministic assessment ('||c_methodology||'): '
    ||v_event.category||' event "'||v_event.label||'"'
    ||', direction='||coalesce(v_event.direction,'unknown')
    ||', decision_impact='||coalesce(v_event.decision_impact,'unknown')
    ||', source='||coalesce(v_event.source_kind,'unknown')
    ||coalesce(':'||v_event.source_id,'')
    ||'. Event confidence '||v_confidence||'/100'
    ||case when v_event.knowledge_time is not null
        then ', known to the world at '||v_event.knowledge_time::text else '' end
    ||case when v_event.disclosure_time is not null
        then ', ingested at '||v_event.disclosure_time::text else '' end
    ||case when v_event.affected_fact_id is not null
        then ', bears on normalized fact '||v_event.affected_fact_id::text else '' end
    ||'. Severity '||v_severity||'.',
    2000
  );

  insert into public.materiality_assessments(
    event_id,severity,confidence,explanation,methodology_version,assessor
  )
  values (
    p_event_id,v_severity,v_confidence,v_explanation,c_methodology,'deterministic-engine'
  )
  on conflict (event_id,methodology_version) do update set
    severity=excluded.severity,
    confidence=excluded.confidence,
    explanation=excluded.explanation,
    assessed_at=now(),
    assessor=excluded.assessor
  returning id into v_assessment_id;

  return v_assessment_id;
end
$$;

revoke all on function consumer_private.assess_company_event_materiality_v1(uuid)
  from public,anon,authenticated;
grant execute on function consumer_private.assess_company_event_materiality_v1(uuid)
  to service_role;

comment on function consumer_private.assess_company_event_materiality_v1(uuid) is
  'Stage A: deterministic company-materiality assessment of one classified event (group-b-event-materiality-v1). Emits explicit not_material rows; no LLM in the path.';

-- Pipeline entrypoint: assess every unassessed event since p_since.
create or replace function consumer_private.assess_company_events_since_v1(
  p_since date default (current_date - 30)
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_since date:=coalesce(p_since,current_date-30);
  v_assessed integer:=0;
  v_high integer:=0;
  v_material integer:=0;
  v_notable integer:=0;
  v_not_material integer:=0;
  r record;
begin
  for r in
    select cce.id
    from public.company_change_events cce
    where cce.occurred_at>=v_since
      and not exists (
        select 1
        from public.materiality_assessments ma
        where ma.event_id=cce.id
          and ma.methodology_version='group-b-event-materiality-v1'
      )
    order by cce.occurred_at,cce.id
  loop
    perform consumer_private.assess_company_event_materiality_v1(r.id);
    v_assessed:=v_assessed+1;
  end loop;

  select
    count(*) filter (where ma.severity='high'),
    count(*) filter (where ma.severity='material'),
    count(*) filter (where ma.severity='notable'),
    count(*) filter (where ma.severity='not_material')
  into v_high,v_material,v_notable,v_not_material
  from public.materiality_assessments ma
  join public.company_change_events cce on cce.id=ma.event_id
  where cce.occurred_at>=v_since
    and ma.methodology_version='group-b-event-materiality-v1';

  return jsonb_build_object(
    'assessed',v_assessed,
    'since',v_since,
    'severity_counts',jsonb_build_object(
      'high',v_high,
      'material',v_material,
      'notable',v_notable,
      'not_material',v_not_material
    ),
    'methodology_version','group-b-event-materiality-v1'
  );
end
$$;

revoke all on function consumer_private.assess_company_events_since_v1(date)
  from public,anon,authenticated;
grant execute on function consumer_private.assess_company_events_since_v1(date)
  to service_role;

create or replace function public.assess_company_events_since_v1(
  p_since date default (current_date - 30)
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select consumer_private.assess_company_events_since_v1(p_since);
$$;

revoke all on function public.assess_company_events_since_v1(date)
  from public,anon,authenticated;
grant execute on function public.assess_company_events_since_v1(date)
  to service_role;

comment on function public.assess_company_events_since_v1(date) is
  'V1 event-ingestion pipeline entrypoint: Stage A assessment of every unassessed classified event since p_since. Service-role only; called by the scheduled detector run.';

-- ---------------------------------------------------------------------------
-- 8. Stage B engine: deterministic per-user assessment.
--    Mirrors PR #137 weight-aware scoring exactly:
--      user_score = clamp(0,100, round(company_score * weight_factor
--                       + thesis_importance_boost))
--    with the equal-weight fallback and neutral follow factor.
-- ---------------------------------------------------------------------------

create or replace function consumer_private.refresh_user_materiality_assessments_v1(
  p_since date default (current_date - 30)
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_since date:=coalesce(p_since,current_date-30);
  v_upserted integer:=0;
  c_methodology constant text:='group-b-user-materiality-v2';
begin
  if v_user_id is null then
    raise exception 'Authentication required.'
      using errcode='42501';
  end if;

  with positions as (
    select
      pp.id as position_id,
      pp.portfolio_id,
      pp.company_id,
      pp.relationship,
      pp.weight as manual_weight_pct,
      pp.market_value,
      pp.quantity,
      pp.average_cost
    from public.portfolio_positions pp
    join public.portfolios p
      on p.id=pp.portfolio_id
     and p.user_id=pp.user_id
    where pp.user_id=v_user_id
  ),
  weighted as (
    select
      p.*,
      case
        when p.relationship='own'
          then coalesce(p.market_value, p.quantity * p.average_cost, 0)
        else null
      end as dollar_basis,
      count(*) filter (where p.relationship='own')
        over (partition by p.portfolio_id) as owned_count,
      sum(
        case
          when p.relationship='own'
            then coalesce(p.market_value, p.quantity * p.average_cost, 0)
          else 0
        end
      ) over (partition by p.portfolio_id) as owned_dollar_total
    from positions p
  ),
  shares as (
    select
      w.*,
      case
        when w.relationship<>'own' then null
        when w.owned_count=0 then 1.0
        when w.owned_dollar_total > 0
          then w.dollar_basis / w.owned_dollar_total
        else 1.0 / w.owned_count
      end as dollar_share
    from weighted w
  ),
  normalized as (
    select
      s.*,
      coalesce(s.manual_weight_pct / 100, s.dollar_share) as raw_share,
      sum(coalesce(s.manual_weight_pct / 100, s.dollar_share))
        over (partition by s.portfolio_id) as raw_total
    from shares s
  ),
  final_weights as (
    select
      n.*,
      case
        when n.relationship<>'own' then 1.0
        when n.owned_count=0 then 1.0
        when n.raw_total > 0
          then (n.raw_share / n.raw_total) * n.owned_count
        else 1.0
      end as weight_factor,
      case
        when n.relationship<>'own' then null
        when n.owned_count=0 then 1.0
        when n.raw_total > 0 then n.raw_share / n.raw_total
        else 1.0 / n.owned_count
      end as weight_share
    from normalized n
  ),
  candidates as (
    select
      ma.id as assessment_id,
      fw.position_id,
      fw.weight_factor,
      fw.weight_share,
      case ma.severity
        when 'high' then 90
        when 'material' then 70
        when 'notable' then 50
        else 0
      end as company_score,
      cce.metric_key,
      cce.occurred_at
    from public.materiality_assessments ma
    join public.company_change_events cce on cce.id=ma.event_id
    join final_weights fw on fw.company_id=cce.company_id
    where ma.methodology_version='group-b-event-materiality-v1'
      and ma.severity<>'not_material'
      and cce.occurred_at>=v_since
  ),
  matched as (
    select
      c.*,
      (
        select (f.importance-3)*5
        from public.position_thesis_factors f
        where f.position_id=c.position_id
          and f.user_id=v_user_id
          and f.enabled
          and nullif(c.metric_key,'') is not null
          and f.factor_key='canonical:metric:'||lower(trim(c.metric_key))
        order by f.importance desc,f.updated_at desc,f.id
        limit 1
      ) as thesis_boost
    from candidates c
  ),
  scored as (
    select
      m.*,
      least(
        100,
        greatest(
          0,
          round(m.company_score * m.weight_factor + coalesce(m.thesis_boost,0))::integer
        )
      ) as user_score
    from matched m
  ),
  ranked as (
    select
      s.*,
      case
        when s.user_score>=90 then 'thesis_priority'
        when s.user_score>=70 then 'important'
        when s.user_score>=50 then 'monitor'
        else 'background'
      end as level,
      dense_rank() over (
        order by s.user_score desc, s.occurred_at desc, s.assessment_id
      ) as display_priority
    from scored s
  )
  insert into public.user_materiality_assessments(
    assessment_id,user_id,position_id,score,level,
    position_weight,thesis_relevance,display_priority,
    methodology_version,assessed_at
  )
  select
    assessment_id,
    v_user_id,
    position_id,
    user_score,
    level,
    weight_share,
    coalesce(thesis_boost,0),
    display_priority,
    c_methodology,
    now()
  from ranked
  on conflict (assessment_id,user_id,position_id) do update set
    score=excluded.score,
    level=excluded.level,
    position_weight=excluded.position_weight,
    thesis_relevance=excluded.thesis_relevance,
    display_priority=excluded.display_priority,
    methodology_version=excluded.methodology_version,
    assessed_at=now();

  get diagnostics v_upserted=row_count;

  return jsonb_build_object(
    'status','ok',
    'upserted',v_upserted,
    'since',v_since,
    'methodology_version',c_methodology
  );
end
$$;

revoke all on function consumer_private.refresh_user_materiality_assessments_v1(date)
  from public,anon;
grant execute on function consumer_private.refresh_user_materiality_assessments_v1(date)
  to authenticated;

create or replace function public.refresh_my_materiality_assessments_v1(
  p_since date default (current_date - 30)
)
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$
  select consumer_private.refresh_user_materiality_assessments_v1(p_since);
$$;

revoke all on function public.refresh_my_materiality_assessments_v1(date)
  from public,anon;
grant execute on function public.refresh_my_materiality_assessments_v1(date)
  to authenticated;

comment on function consumer_private.refresh_user_materiality_assessments_v1(date) is
  'Stage B: deterministic per-user materiality assessment (group-b-user-materiality-v2). Weight rule mirrors PR #137 exactly; follow positions stay neutral; missing dollars fall back to equal weighting.';
comment on function public.refresh_my_materiality_assessments_v1(date) is
  'Stage B authenticated refresh. User identity comes only from auth.uid(); no trading recommendation is produced.';

-- ---------------------------------------------------------------------------
-- 9. B4 contract: prefer the persisted Stage A assessment; fall back to the
--    legacy v1 mapping for unassessed rows. not_material events are excluded.
-- ---------------------------------------------------------------------------

create or replace function consumer_private.get_company_materiality_events_v1(
  p_company_id uuid,
  p_since date default (current_date - 30),
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
  v_since date:=coalesce(p_since,current_date-30);
  v_company public.companies;
  v_events jsonb;
  v_count integer;
begin
  select * into v_company
  from public.companies
  where id=p_company_id;

  if not found then
    raise exception 'Unknown company %.',p_company_id;
  end if;

  with normalized as (
    select
      'company_change'::text as source_kind,
      cce.id::text as source_record_id,
      cce.occurred_at::timestamptz as event_time,
      cce.category as event_type,
      cce.metric_key,
      cce.label,
      cce.summary,
      coalesce(ma.severity,cce.materiality) as materiality_level,
      case coalesce(ma.severity,cce.materiality)
        when 'high' then 90
        when 'material' then 70
        when 'notable' then 50
        else 30
      end as materiality_score,
      coalesce(ma.methodology_version,'group-b-company-materiality-v1')
        as assessment_methodology,
      ma.confidence as assessment_confidence,
      ma.explanation as assessment_explanation,
      cce.decision_impact as decision_effect,
      cce.direction,
      'recorded'::text as event_status,
      jsonb_build_object(
        'source_kind',cce.source_kind,
        'source_id',cce.source_id,
        'source_url',cce.source_url,
        'old_value',cce.old_value,
        'new_value',cce.new_value,
        'delta_value',cce.delta_value,
        'delta_percent',cce.delta_percent,
        'old_text',cce.old_text,
        'new_text',cce.new_text,
        'confidence',cce.confidence,
        'knowledge_time',cce.knowledge_time,
        'disclosure_time',cce.disclosure_time,
        'affected_fact_id',cce.affected_fact_id
      ) as evidence
    from public.company_change_events cce
    left join lateral (
      select ma.severity,ma.confidence,ma.explanation,ma.methodology_version
      from public.materiality_assessments ma
      where ma.event_id=cce.id
      order by ma.assessed_at desc,ma.created_at desc,ma.id desc
      limit 1
    ) ma on true
    where cce.company_id=p_company_id
      and cce.occurred_at>=v_since
      and coalesce(ma.severity,cce.materiality)<>'not_material'

    union all

    select
      'decision_trigger'::text,
      dt.id::text,
      coalesce(dt.first_triggered_at,dt.last_evaluated_at) as event_time,
      'decision_trigger'::text,
      dt.metric_key,
      dt.label,
      dt.rationale,
      dt.severity,
      case dt.severity
        when 'high' then 90
        when 'material' then 70
        else 40
      end,
      'group-b-company-materiality-v1'::text,
      null::integer,
      null::text,
      dt.decision_effect,
      null::text,
      dt.evaluation_status,
      jsonb_build_object(
        'trigger_key',dt.trigger_key,
        'trigger_group',dt.trigger_group,
        'comparator',dt.comparator,
        'threshold_value',dt.threshold_value,
        'threshold_unit',dt.threshold_unit,
        'current_value',dt.current_value,
        'current_text',dt.current_text,
        'source_kind',dt.source_kind,
        'source_ref',dt.source_ref,
        'metadata',dt.metadata
      )
    from public.decision_triggers dt
    where dt.company_id=p_company_id
      and dt.evaluation_status in ('triggered','needs_review')
      and coalesce(dt.first_triggered_at,dt.last_evaluated_at)::date>=v_since
  ),
  limited as (
    select *
    from normalized
    order by materiality_score desc,event_time desc,source_kind,source_record_id
    limit v_limit
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'event_id',source_kind||':'||source_record_id,
      'source_kind',source_kind,
      'source_record_id',source_record_id,
      'occurred_at',event_time,
      'event_type',event_type,
      'metric_key',metric_key,
      'label',label,
      'summary',summary,
      'company_materiality',jsonb_build_object(
        'level',materiality_level,
        'score',materiality_score,
        'methodology_version',assessment_methodology,
        'confidence',assessment_confidence,
        'explanation',assessment_explanation
      ),
      'decision_effect',decision_effect,
      'direction',direction,
      'event_status',event_status,
      'evidence',evidence
    ) order by materiality_score desc,event_time desc,source_kind,source_record_id),'[]'::jsonb),
    count(*)::integer
  into v_events,v_count
  from limited;

  return jsonb_build_object(
    'contract_version','group-b-company-materiality-v1',
    'company',jsonb_build_object(
      'id',v_company.id,
      'ticker',v_company.ticker,
      'company_name',v_company.company_name
    ),
    'since',v_since,
    'event_count',v_count,
    'events',v_events
  );
end
$$;

comment on function consumer_private.get_company_materiality_events_v1(uuid,date,integer) is
  'Privileged non-exposed B4 helper; contains no user-owned data. Prefers the persisted Stage A assessment (group-b-event-materiality-v1) when present; falls back to the legacy v1 mapping. not_material events are excluded.';
