-- V1 Personal Ranking — Owned + Watch universe (PRD Build 3 of 3).
--
-- The ranking is per-user over the user's private universe (their own positions
-- relationship='own' plus their watchlist relationship='follow'). It never
-- compares across users and never forms a market-wide leaderboard.
--
-- 1. Entitlements on public.profiles:
--      monitored_name_cap  integer default 12  (Free indicative 8-12, Plus 40-75)
--      deep_research_quota integer default 2   (deep-research requests per rolling 30 days)
--    Everyone defaults to the Free cap. A before-insert guard on
--    portfolio_positions rejects universe growth past the cap with a clear
--    message; upserts of an already-monitored company are not growth and pass.
-- 2. public.company_relationships — reference rows linking a company to its
--    suppliers / competitors / customers / regulators. Public read,
--    service_role write (same model as event_taxonomy).
-- 3. company_change_events.affected_company_id — the company whose thesis an
--    event affects when it differs from the event's own company. Deterministic
--    attach via consumer_private.attach_event_affected_company_v1 (explicit
--    affected_company_id wins; only competition/business/regulatory/
--    capital_allocation categories attach; deterministic relationship
--    priority supplier > competitor > customer > regulator, then company_id).
--    Service-role-only public wrapper for the ingestion worker.
-- 4. Research-demand quota: a before-insert guard on research_demand_requests
--    enforces the per-user deep_dive quota over a rolling 30-day window
--    (coverage/refresh/question requests are not quota-limited), plus
--      consumer_private.get_my_research_request_quota_v1()
--      consumer_private.get_my_request_queue_position_v1(p_request_id)
--    with authenticated public wrappers. Queue position is computed over all
--    users' active deep_dive requests for the caller's OWN request only —
--    an internal triage signal, never a leaderboard (no user identities leave).
-- 5. consumer_private.get_my_personal_ranking_v1 (+ authenticated public
--    wrapper): the personal ranking contract, methodology_version
--    'personal-ranking-v1'. personal_score =
--      clamp(0,100, round(company_score * weight_factor * owned_boost
--                         + thesis_importance_boost))
--    company_score comes from the persisted Stage A assessment when present
--    (group-b-event-materiality-v1, else the legacy mapping), weight_factor is
--    PR #137's deterministic position-weight rule (follow = neutral 1.0),
--    owned_boost = 1.25 for owned / 0.75 for watched, thesis_importance_boost =
--    (importance-3)*5 from the user's enabled pinned thesis factors
--    (position_thesis_factors). Events join on company_id OR
--    affected_company_id, so supplier/competitor/regulatory events are filed
--    under the owned company whose thesis they affect. Decision triggers are
--    included as direct-company items (same severity mapping as B4).
-- 6. consumer_private.refresh_user_materiality_assessments_v1 (Stage B) now
--    also matches affected_company_id-attached events. The scoring formula is
--    unchanged, so it stays on methodology group-b-user-materiality-v2.
--
-- Deterministic; methodology_version on the new scoring; owner-scoped RLS on
-- everything user-owned; no secrets; no Money integration; no trades.

-- ---------------------------------------------------------------------------
-- 1. Entitlements on profiles.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists monitored_name_cap integer not null default 12
    check (monitored_name_cap between 1 and 10000),
  add column if not exists deep_research_quota integer not null default 2
    check (deep_research_quota between 0 and 10000);

comment on column public.profiles.monitored_name_cap is
  'V1 personal ranking: max distinct companies (owned + watched) the user may monitor. Default 12 (Free indicative 8-12; Plus indicative 40-75). Enforced on Add.';
comment on column public.profiles.deep_research_quota is
  'V1 personal ranking: deep-research (deep_dive) requests allowed per rolling 30-day window. Enforced on Request.';

-- Backfill defensively: the not-null defaults above already cover existing
-- rows, but profiles created before this migration keep their defaults.
-- New users get the defaults from private.handle_consumer_user_created_v1
-- (column defaults apply on insert).

-- ---------------------------------------------------------------------------
-- 2. Cap guard on Add: reject universe growth past the monitored-name cap.
-- ---------------------------------------------------------------------------

create or replace function private.guard_monitored_name_cap_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_cap integer;
  v_names integer;
begin
  -- An upsert of a company the user already monitors is not universe growth:
  -- updating the same name (even into another portfolio) always passes.
  if exists (
    select 1
    from public.portfolio_positions pp
    where pp.user_id=new.user_id
      and pp.company_id=new.company_id
  ) then
    return new;
  end if;

  select coalesce(p.monitored_name_cap,12)
  into v_cap
  from public.profiles p
  where p.user_id=new.user_id;
  v_cap:=coalesce(v_cap,12);

  select count(distinct pp.company_id)
  into v_names
  from public.portfolio_positions pp
  where pp.user_id=new.user_id;

  if v_names >= v_cap then
    raise exception
      'Monitored-name cap reached (% of % monitored names). Remove a monitored name before adding another.',
      v_names,v_cap;
  end if;

  return new;
end
$$;

revoke all on function private.guard_monitored_name_cap_v1()
  from public,anon,authenticated;

drop trigger if exists portfolio_positions_monitored_name_cap
  on public.portfolio_positions;
create trigger portfolio_positions_monitored_name_cap
before insert on public.portfolio_positions
for each row execute function private.guard_monitored_name_cap_v1();

comment on function private.guard_monitored_name_cap_v1() is
  'V1 personal ranking: enforces profiles.monitored_name_cap on Add (insert into portfolio_positions). Distinct companies per user; upserts of already-monitored names pass.';

-- ---------------------------------------------------------------------------
-- 3. Company relationships (supplier / competitor / customer / regulator).
-- ---------------------------------------------------------------------------

create table if not exists public.company_relationships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.companies(id) on delete cascade,
  related_company_id uuid not null
    references public.companies(id) on delete cascade,
  relationship_type text not null
    check (relationship_type in ('supplier','competitor','customer','regulator')),
  provenance text null
    check (provenance is null or char_length(provenance) between 1 and 500),
  created_at timestamptz not null default now(),
  constraint company_relationships_no_self_check
    check (company_id <> related_company_id),
  constraint company_relationships_unique
    unique (company_id,related_company_id,relationship_type)
);

create index if not exists company_relationships_related_idx
  on public.company_relationships(related_company_id,relationship_type);

comment on table public.company_relationships is
  'V1 personal ranking: reference rows linking a company to its suppliers, competitors, customers, and regulators. company_id is the subject whose thesis is affected; related_company_id is the external party. Drives deterministic event attachment (affected_company_id).';

alter table public.company_relationships enable row level security;

revoke all on public.company_relationships from public,anon,authenticated;
grant select on public.company_relationships to anon,authenticated;
grant select,insert,update,delete on public.company_relationships to service_role;

drop policy if exists "public read company relationships"
  on public.company_relationships;
create policy "public read company relationships"
on public.company_relationships for select
to anon,authenticated using (true);

drop policy if exists "service role manages company relationships"
  on public.company_relationships;
create policy "service role manages company relationships"
on public.company_relationships for all
to service_role using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 4. affected_company_id on events + deterministic attach.
-- ---------------------------------------------------------------------------

alter table public.company_change_events
  add column if not exists affected_company_id uuid null
    references public.companies(id) on delete set null;

create index if not exists company_change_events_affected_company_idx
  on public.company_change_events(affected_company_id,occurred_at desc);

comment on column public.company_change_events.affected_company_id is
  'V1 personal ranking: the company whose thesis this event affects when it differs from company_id (e.g. a supplier event filed under the supplied company). Set deterministically by attach_event_affected_company_v1 or explicitly by the detector; never overwritten once set.';

create or replace function consumer_private.attach_event_affected_company_v1(
  p_event_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_event public.company_change_events%rowtype;
  v_affected uuid;
begin
  select * into v_event
  from public.company_change_events
  where id=p_event_id;

  if not found then
    raise exception 'Unknown company_change_event %.',p_event_id;
  end if;

  -- An explicit affected_company_id always wins; the attach never overwrites.
  if v_event.affected_company_id is not null then
    return v_event.affected_company_id;
  end if;

  -- Only external-party categories can attach elsewhere. A company's own
  -- financial / guidance / management / research events describe itself.
  if v_event.category not in (
    'competition','business','regulatory','capital_allocation'
  ) then
    return null;
  end if;

  -- Deterministic pick: relationship priority, then company_id.
  select cr.company_id into v_affected
  from public.company_relationships cr
  where cr.related_company_id=v_event.company_id
    and cr.relationship_type in ('supplier','competitor','customer','regulator')
  order by
    case cr.relationship_type
      when 'supplier' then 1
      when 'competitor' then 2
      when 'customer' then 3
      else 4
    end,
    cr.company_id
  limit 1;

  if v_affected is not null then
    update public.company_change_events
    set affected_company_id=v_affected,
        updated_at=now()
    where id=p_event_id;
  end if;

  return v_affected;
end
$$;

revoke all on function consumer_private.attach_event_affected_company_v1(uuid)
  from public,anon,authenticated;
grant execute on function consumer_private.attach_event_affected_company_v1(uuid)
  to service_role;

comment on function consumer_private.attach_event_affected_company_v1(uuid) is
  'V1 personal ranking: deterministic supplier/competitor/regulator event attachment. Returns the affected company_id (null when nothing attaches). No LLM in the path.';

-- Service-role-only public wrapper (PostgREST exposes only the public schema).
create or replace function public.attach_event_affected_company_v1(
  p_event_id uuid
)
returns uuid
language sql
security invoker
set search_path=''
as $$
  select consumer_private.attach_event_affected_company_v1(p_event_id);
$$;

revoke all on function public.attach_event_affected_company_v1(uuid)
  from public,anon,authenticated;
grant execute on function public.attach_event_affected_company_v1(uuid)
  to service_role;

comment on function public.attach_event_affected_company_v1(uuid) is
  'V1 personal ranking (service-role only). Ingestion-worker entry point for deterministic event attachment. Revoked from anon/authenticated.';

-- ---------------------------------------------------------------------------
-- 5. Research-demand quota (Request) + queue position.
-- ---------------------------------------------------------------------------

create or replace function private.guard_research_request_quota_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_quota integer;
  v_used integer;
  c_window constant interval:='30 days';
begin
  -- Only deep research is expensive and quota-limited. Coverage / refresh /
  -- question requests are cheap triage signals and are never quota-limited.
  if new.request_type <> 'deep_dive' then
    return new;
  end if;

  -- An update that keeps an existing deep-dive request is not new demand.
  if tg_op = 'UPDATE' and old.request_type = 'deep_dive' then
    return new;
  end if;

  -- Upserting the user's existing request for the same company is not new
  -- demand (it updates priority/question), so it never consumes quota. The
  -- ON CONFLICT DO UPDATE path reaches this trigger as UPDATE; converting
  -- another request type into a deep dive falls through to quota below.
  if tg_op = 'INSERT' and exists (
    select 1
    from public.research_demand_requests r
    where r.user_id=new.user_id
      and r.company_id=new.company_id
  ) then
    return new;
  end if;

  select coalesce(p.deep_research_quota,2)
  into v_quota
  from public.profiles p
  where p.user_id=new.user_id;
  v_quota:=coalesce(v_quota,2);

  select count(*)
  into v_used
  from public.research_demand_requests r
  where r.user_id=new.user_id
    and r.request_type='deep_dive'
    and r.created_at >= now() - c_window
    and (tg_op = 'INSERT' or r.id <> old.id);

  if v_used >= v_quota then
    raise exception
      'deep_dive_quota_exceeded: deep-research quota reached (% of % requests per 30 days).',
      v_used,v_quota;
  end if;

  return new;
end
$$;

revoke all on function private.guard_research_request_quota_v1()
  from public,anon,authenticated;

drop trigger if exists research_demand_requests_quota_guard
  on public.research_demand_requests;
create trigger research_demand_requests_quota_guard
before insert or update on public.research_demand_requests
for each row execute function private.guard_research_request_quota_v1();

comment on function private.guard_research_request_quota_v1() is
  'V1 personal ranking: enforces profiles.deep_research_quota on deep_dive inserts and conversions over a rolling 30-day window. Other request types and updates that keep an existing deep dive are unaffected.';

-- Quota readout for the Request UI.
create or replace function consumer_private.get_my_research_request_quota_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_quota integer;
  v_used integer;
  c_window_days constant integer:=30;
begin
  if v_user_id is null then
    raise exception 'Authentication required.'
      using errcode='42501';
  end if;

  select coalesce(p.deep_research_quota,2)
  into v_quota
  from public.profiles p
  where p.user_id=v_user_id;
  v_quota:=coalesce(v_quota,2);

  select count(*)
  into v_used
  from public.research_demand_requests r
  where r.user_id=v_user_id
    and r.request_type='deep_dive'
    and r.created_at >= now() - (c_window_days::text||' days')::interval;

  return jsonb_build_object(
    'quota',v_quota,
    'used',v_used,
    'remaining',greatest(v_quota - v_used,0),
    'window_days',c_window_days,
    'methodology_version','personal-ranking-v1'
  );
end
$$;

revoke all on function consumer_private.get_my_research_request_quota_v1()
  from public,anon;
grant execute on function consumer_private.get_my_research_request_quota_v1()
  to authenticated;

create or replace function public.get_my_research_request_quota_v1()
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$
  select consumer_private.get_my_research_request_quota_v1();
$$;

revoke all on function public.get_my_research_request_quota_v1()
  from public,anon;
grant execute on function public.get_my_research_request_quota_v1()
  to authenticated;

comment on function public.get_my_research_request_quota_v1() is
  'V1 personal ranking: the caller''s deep-research quota usage over the rolling 30-day window. Owner-scoped via auth.uid().';

-- Queue position for the caller's own deep-research request. The queue is the
-- internal triage order (priority desc, created_at asc); only the position
-- numbers for the caller's own request are returned — never a leaderboard and
-- never other users' identities.
create or replace function consumer_private.get_my_request_queue_position_v1(
  p_request_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_owner uuid;
  v_is_deep_dive boolean;
  v_pos integer;
  v_total integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required.'
      using errcode='42501';
  end if;

  select r.user_id,(r.request_type='deep_dive' and r.active)
  into v_owner,v_is_deep_dive
  from public.research_demand_requests r
  where r.id=p_request_id;

  if not found then
    raise exception 'Unknown research request.';
  end if;

  if v_owner <> v_user_id then
    raise exception 'Not your research request.'
      using errcode='42501';
  end if;

  if not coalesce(v_is_deep_dive,false) then
    return jsonb_build_object(
      'request_id',p_request_id,
      'queue_position',null,
      'queue_total',0,
      'queued',false,
      'methodology_version','personal-ranking-v1'
    );
  end if;

  with queue as (
    select
      r.id,
      row_number() over (
        order by r.priority desc, r.created_at asc, r.id
      ) as pos
    from public.research_demand_requests r
    where r.active
      and r.request_type='deep_dive'
  )
  select q.pos,(select count(*)::integer from queue)
  into v_pos,v_total
  from queue q
  where q.id=p_request_id;

  return jsonb_build_object(
    'request_id',p_request_id,
    'queue_position',v_pos,
    'queue_total',coalesce(v_total,0),
    'queued',v_pos is not null,
    'methodology_version','personal-ranking-v1'
  );
end
$$;

revoke all on function consumer_private.get_my_request_queue_position_v1(uuid)
  from public,anon;
grant execute on function consumer_private.get_my_request_queue_position_v1(uuid)
  to authenticated;

create or replace function public.get_my_request_queue_position_v1(
  p_request_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$
  select consumer_private.get_my_request_queue_position_v1(p_request_id);
$$;

revoke all on function public.get_my_request_queue_position_v1(uuid)
  from public,anon;
grant execute on function public.get_my_request_queue_position_v1(uuid)
  to authenticated;

comment on function public.get_my_request_queue_position_v1(uuid) is
  'V1 personal ranking: queue position of the caller''s own deep-research request. Owner-scoped via auth.uid(); never exposes other users'' requests.';
-- ---------------------------------------------------------------------------
-- 6. Stage B: also assess affected_company_id-attached events.
--    (Full function re-created from 20260926160000_v1_event_ingestion.sql with
--    the single join widened; scoring formula and methodology_version
--    group-b-user-materiality-v2 are unchanged.)
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
    -- V1 personal ranking: attached events (affected_company_id) are assessed
    -- for the owned company whose thesis they affect, in addition to
    -- direct company events. Scoring formula unchanged
    -- (group-b-user-materiality-v2).
    join final_weights fw
      on (fw.company_id=cce.company_id
       or fw.company_id=cce.affected_company_id)
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
-- ---------------------------------------------------------------------------
-- 7. Personal ranking contract (methodology personal-ranking-v1).
-- ---------------------------------------------------------------------------
--
-- The ranking is per-user over the user's private universe (own + follow).
-- personal_score = clamp(0,100, round(company_score * weight_factor
--                    * owned_boost + thesis_importance_boost))
--   company_score: Stage A severity (high 90 / material 70 / notable 50),
--                  legacy mapping fallback; not_material excluded upstream.
--   weight_factor: PR #137's deterministic position-weight rule
--                  (follow = neutral 1.0).
--   owned_boost:   1.25 for owned, 0.75 for watched — deterministic constants.
--   thesis_importance_boost: (importance-3)*5 from the user's enabled pinned
--                  thesis factors (position_thesis_factors).
-- Events join on company_id OR affected_company_id: supplier/competitor/
-- regulatory events are filed under the owned company whose thesis they
-- affect. Decision triggers are included as direct-company items.

create or replace function consumer_private.get_my_personal_ranking_v1(
  p_since date default (current_date - 30),
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_since date:=coalesce(p_since,current_date-30);
  v_limit integer:=least(greatest(coalesce(p_limit,100),1),200);
  v_items jsonb;
  v_count integer;
  v_owned integer;
  v_watch integer;
  v_cap integer;
  v_source_status text;
  c_methodology constant text:='personal-ranking-v1';
  c_owned_boost constant numeric:=1.25;
  c_watch_factor constant numeric:=0.75;
begin
  if v_user_id is null then
    raise exception 'Authentication required.'
      using errcode='42501';
  end if;

  select
    count(*) filter (where pp.relationship='own'),
    count(*) filter (where pp.relationship='follow')
  into v_owned,v_watch
  from public.portfolio_positions pp
  where pp.user_id=v_user_id;

  select coalesce(p.monitored_name_cap,12)
  into v_cap
  from public.profiles p
  where p.user_id=v_user_id;
  v_cap:=coalesce(v_cap,12);

  with positions as (
    select
      pp.id as position_id,
      pp.portfolio_id,
      pf.name as portfolio_name,
      pp.company_id,
      c.ticker,
      c.company_name,
      pp.relationship,
      pp.weight as manual_weight_pct,
      pp.market_value,
      pp.quantity,
      pp.average_cost
    from public.portfolio_positions pp
    join public.portfolios pf
      on pf.id=pp.portfolio_id
     and pf.user_id=pp.user_id
    join public.companies c on c.id=pp.company_id
    where pp.user_id=v_user_id
  ),
  -- V1 position weights, computed per portfolio (PR #137 rule, unchanged):
  -- missing position dollars fall back to equal weighting among owned names
  -- (never exclusion); follow positions stay neutral (factor 1.0).
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
      end as weight_share,
      -- V1 personal ranking: deterministic owned boost. Owned names rank
      -- above watched names at equal materiality; watched names can still
      -- surface via pinned thesis factors.
      case
        when n.relationship='own' then c_owned_boost
        else c_watch_factor
      end as owned_boost,
      case
        when n.relationship<>'own' then 'follow'
        when n.manual_weight_pct is not null then 'manual'
        when n.market_value is not null then 'market_value'
        when n.average_cost is not null then 'cost_basis'
        else 'equal_share'
      end as weight_basis
    from normalized n
  ),
  source_freshness as (
    select
      p.company_id,
      (
        select max(css.observed_at)
        from public.company_state_snapshots css
        where css.company_id=p.company_id
      ) as change_engine_as_of,
      (
        select max(dt.last_evaluated_at)
        from public.decision_triggers dt
        where dt.company_id=p.company_id
      ) as trigger_engine_as_of
    from final_weights p
    group by p.company_id
  ),
  universe_events as (
    -- Ingested events: direct company events plus events attached via
    -- affected_company_id (supplier/competitor/regulatory). not_material
    -- events are excluded (reviewed and dismissed).
    select
      fw.position_id,
      fw.portfolio_id,
      fw.portfolio_name,
      fw.company_id,
      fw.ticker,
      fw.company_name,
      fw.relationship,
      fw.weight_share,
      fw.weight_factor,
      fw.weight_basis,
      fw.owned_boost,
      sf.change_engine_as_of,
      sf.trigger_engine_as_of,
      case
        when sf.change_engine_as_of is not null and sf.trigger_engine_as_of is not null
          then least(sf.change_engine_as_of,sf.trigger_engine_as_of)
        else coalesce(sf.change_engine_as_of,sf.trigger_engine_as_of)
      end as source_as_of,
      'company_change:'||cce.id::text as event_id,
      'company_change'::text as source_kind,
      cce.id::text as source_record_id,
      cce.occurred_at::timestamptz as occurred_at,
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
      end as company_score,
      coalesce(ma.methodology_version,'group-b-company-materiality-v1')
        as assessment_methodology,
      ma.confidence as assessment_confidence,
      ma.explanation as assessment_explanation,
      cce.decision_impact as decision_effect,
      cce.direction,
      'recorded'::text as event_status,
      cce.company_id as event_company_id,
      ec.ticker as event_company_ticker,
      ec.company_name as event_company_name,
      (cce.company_id <> fw.company_id) as is_attached,
      att.relationship_type as attach_relationship,
      cce.source_kind as ev_source_kind,
      cce.source_id as ev_source_id,
      cce.source_url as ev_source_url,
      cce.old_value as ev_old_value,
      cce.new_value as ev_new_value,
      cce.delta_value as ev_delta_value,
      cce.delta_percent as ev_delta_percent,
      cce.old_text as ev_old_text,
      cce.new_text as ev_new_text,
      cce.confidence as ev_confidence,
      cce.knowledge_time as ev_knowledge_time,
      cce.disclosure_time as ev_disclosure_time,
      cce.affected_fact_id as ev_affected_fact_id,
      null::text as ev_trigger_key,
      null::text as ev_trigger_group,
      null::text as ev_comparator,
      null::numeric as ev_threshold_value,
      null::text as ev_threshold_unit,
      null::numeric as ev_current_value,
      null::text as ev_current_text,
      null::text as ev_source_ref,
      null::jsonb as ev_metadata
    from final_weights fw
    left join source_freshness sf on sf.company_id=fw.company_id
    join public.company_change_events cce
      on (cce.company_id=fw.company_id
       or cce.affected_company_id=fw.company_id)
    join public.companies ec on ec.id=cce.company_id
    left join lateral (
      select m.severity,m.confidence,m.explanation,m.methodology_version
      from public.materiality_assessments m
      where m.event_id=cce.id
      order by m.assessed_at desc,m.created_at desc,m.id desc
      limit 1
    ) ma on true
    left join lateral (
      select cr.relationship_type
      from public.company_relationships cr
      where cr.company_id=fw.company_id
        and cr.related_company_id=cce.company_id
        and cr.relationship_type in ('supplier','competitor','customer','regulator')
      order by
        case cr.relationship_type
          when 'supplier' then 1
          when 'competitor' then 2
          when 'customer' then 3
          else 4
        end
      limit 1
    ) att on true
    where cce.occurred_at >= v_since
      and coalesce(ma.severity,cce.materiality) <> 'not_material'

    union all

    -- Decision triggers: direct-company items (no attachment applies).
    select
      fw.position_id,
      fw.portfolio_id,
      fw.portfolio_name,
      fw.company_id,
      fw.ticker,
      fw.company_name,
      fw.relationship,
      fw.weight_share,
      fw.weight_factor,
      fw.weight_basis,
      fw.owned_boost,
      sf.change_engine_as_of,
      sf.trigger_engine_as_of,
      case
        when sf.change_engine_as_of is not null and sf.trigger_engine_as_of is not null
          then least(sf.change_engine_as_of,sf.trigger_engine_as_of)
        else coalesce(sf.change_engine_as_of,sf.trigger_engine_as_of)
      end as source_as_of,
      'decision_trigger:'||dt.id::text as event_id,
      'decision_trigger'::text as source_kind,
      dt.id::text as source_record_id,
      coalesce(dt.first_triggered_at,dt.last_evaluated_at) as occurred_at,
      'decision_trigger'::text as event_type,
      dt.metric_key,
      dt.label,
      dt.rationale as summary,
      dt.severity as materiality_level,
      case dt.severity
        when 'high' then 90
        when 'material' then 70
        else 40
      end as company_score,
      'group-b-company-materiality-v1'::text as assessment_methodology,
      null::integer as assessment_confidence,
      null::text as assessment_explanation,
      dt.decision_effect,
      null::text as direction,
      dt.evaluation_status as event_status,
      dt.company_id as event_company_id,
      fw.ticker as event_company_ticker,
      fw.company_name as event_company_name,
      false as is_attached,
      null::text as attach_relationship,
      dt.source_kind as ev_source_kind,
      null::text as ev_source_id,
      null::text as ev_source_url,
      null::numeric as ev_old_value,
      null::numeric as ev_new_value,
      null::numeric as ev_delta_value,
      null::numeric as ev_delta_percent,
      null::text as ev_old_text,
      null::text as ev_new_text,
      null::integer as ev_confidence,
      null::timestamptz as ev_knowledge_time,
      null::timestamptz as ev_disclosure_time,
      null::uuid as ev_affected_fact_id,
      dt.trigger_key as ev_trigger_key,
      dt.trigger_group as ev_trigger_group,
      dt.comparator as ev_comparator,
      dt.threshold_value as ev_threshold_value,
      dt.threshold_unit as ev_threshold_unit,
      dt.current_value as ev_current_value,
      dt.current_text as ev_current_text,
      dt.source_ref as ev_source_ref,
      dt.metadata as ev_metadata
    from final_weights fw
    left join source_freshness sf on sf.company_id=fw.company_id
    join public.decision_triggers dt on dt.company_id=fw.company_id
    where dt.evaluation_status in ('triggered','needs_review')
      and coalesce(dt.first_triggered_at,dt.last_evaluated_at)::date >= v_since
  ),
  matched as (
    select
      ue.*,
      factor.id as factor_id,
      factor.factor_label,
      factor.importance,
      factor.personal_expectation,
      factor.personal_breaker_condition
    from universe_events ue
    left join lateral (
      select f.*
      from public.position_thesis_factors f
      where f.position_id=ue.position_id
        and f.user_id=v_user_id
        and f.enabled
        and nullif(ue.metric_key,'') is not null
        and f.factor_key=
          'canonical:metric:'||lower(trim(ue.metric_key))
      order by f.importance desc,f.updated_at desc,f.id
      limit 1
    ) factor on true
  ),
  scored as (
    select
      m.*,
      least(
        100,
        greatest(
          0,
          round(
            m.company_score * m.weight_factor * m.owned_boost
            + case
                when m.factor_id is null then 0
                else (m.importance-3)*5
              end
          )::integer
        )
      ) as personal_score,
      case
        when m.source_as_of is null then 'unavailable'
        when m.source_as_of < now()-interval '72 hours' then 'stale'
        else 'current'
      end as source_status
    from matched m
  ),
  limited as (
    select *
    from scored
    order by personal_score desc,
             occurred_at desc,
             position_id,
             event_id
    limit v_limit
  ),
  aggregate_items as (
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'item_id',position_id::text||':'||event_id,
            'position',jsonb_build_object(
              'id',position_id,
              'portfolio_id',portfolio_id,
              'portfolio_name',portfolio_name,
              'company_id',company_id,
              'ticker',ticker,
              'company_name',company_name,
              'relationship',relationship,
              'weight_share',weight_share,
              'weight_factor',weight_factor,
              'weight_basis',weight_basis,
              'owned_boost',owned_boost
            ),
            'event',jsonb_build_object(
              'event_id',event_id,
              'source_kind',source_kind,
              'source_record_id',source_record_id,
              'occurred_at',occurred_at,
              'event_type',event_type,
              'metric_key',metric_key,
              'label',label,
              'summary',summary,
              'company_materiality',jsonb_build_object(
                'level',materiality_level,
                'score',company_score,
                'methodology_version',assessment_methodology,
                'confidence',assessment_confidence,
                'explanation',assessment_explanation
              ),
              'decision_effect',decision_effect,
              'direction',direction,
              'event_status',event_status,
              'attached_via',case when is_attached then jsonb_build_object(
                'event_company_ticker',event_company_ticker,
                'event_company_name',event_company_name,
                'relationship',attach_relationship,
                'filed_under_ticker',ticker
              ) else null end,
              'evidence',case when source_kind='company_change' then jsonb_build_object(
                'source_kind',ev_source_kind,
                'source_id',ev_source_id,
                'source_url',ev_source_url,
                'old_value',ev_old_value,
                'new_value',ev_new_value,
                'delta_value',ev_delta_value,
                'delta_percent',ev_delta_percent,
                'old_text',ev_old_text,
                'new_text',ev_new_text,
                'confidence',ev_confidence,
                'knowledge_time',ev_knowledge_time,
                'disclosure_time',ev_disclosure_time,
                'affected_fact_id',ev_affected_fact_id
              ) else jsonb_build_object(
                'trigger_key',ev_trigger_key,
                'trigger_group',ev_trigger_group,
                'comparator',ev_comparator,
                'threshold_value',ev_threshold_value,
                'threshold_unit',ev_threshold_unit,
                'current_value',ev_current_value,
                'current_text',ev_current_text,
                'source_kind',ev_source_kind,
                'source_ref',ev_source_ref,
                'metadata',ev_metadata
              ) end
            ),
            'user_materiality',jsonb_build_object(
              'score',personal_score,
              'level',case
                when personal_score>=90 then 'thesis_priority'
                when personal_score>=70 then 'important'
                when personal_score>=50 then 'monitor'
                else 'background'
              end,
              'personalized',factor_id is not null,
              'matched_factor_id',factor_id,
              'matched_factor_label',factor_label,
              'importance',importance,
              'personal_expectation',personal_expectation,
              'personal_breaker_condition',personal_breaker_condition,
              'weight_factor',weight_factor,
              'owned_boost',owned_boost,
              'reason',case
                when factor_id is not null
                  then 'Matches an enabled thesis factor with importance '
                    ||importance::text||'/5.'
                else 'No enabled personalized thesis factor matched this event metric.'
              end,
              'methodology_version',c_methodology
            ),
            'source_freshness',jsonb_build_object(
              'status',source_status,
              'source_as_of',source_as_of,
              'change_engine_as_of',change_engine_as_of,
              'trigger_engine_as_of',trigger_engine_as_of,
              'age_hours',case
                when source_as_of is null then null
                else round(
                  extract(epoch from (now()-source_as_of))/3600.0,
                  1
                )
              end
            )
          )
          order by personal_score desc,
                   occurred_at desc,
                   position_id,
                   event_id
        ),
        '[]'::jsonb
      ) as items,
      count(*)::integer as item_count,
      case
        when count(*)=0 then 'no_items'
        when bool_or(source_status='unavailable') then 'unavailable'
        when bool_or(source_status='stale') then 'stale'
        else 'current'
      end as overall_source_status
    from limited
  )
  select items,item_count,overall_source_status
  into v_items,v_count,v_source_status
  from aggregate_items;

  return jsonb_build_object(
    'contract_version','personal-ranking-v1',
    'methodology_version',c_methodology,
    'generated_at',now(),
    'since',v_since,
    'item_count',coalesce(v_count,0),
    'source_status',coalesce(v_source_status,'no_items'),
    'universe',jsonb_build_object(
      'owned_names',coalesce(v_owned,0),
      'watch_names',coalesce(v_watch,0),
      'monitored_names',coalesce(v_owned,0)+coalesce(v_watch,0),
      'monitored_name_cap',v_cap
    ),
    'items',coalesce(v_items,'[]'::jsonb)
  );
end
$$;

revoke all on function consumer_private.get_my_personal_ranking_v1(date,integer)
  from public,anon;
grant execute on function consumer_private.get_my_personal_ranking_v1(date,integer)
  to authenticated;

comment on function consumer_private.get_my_personal_ranking_v1(date,integer) is
  'V1 personal ranking (personal-ranking-v1): per-user ranking over the user''s own+watch universe. personal_score = company_score * weight_factor * owned_boost + pinned-factor boost. Supplier/competitor/regulatory events are filed under the owned company via affected_company_id. Never compares across users.';

create or replace function public.get_my_personal_ranking_v1(
  p_since date default (current_date - 30),
  p_limit integer default 100
)
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$
  select consumer_private.get_my_personal_ranking_v1(p_since,p_limit);
$$;

revoke all on function public.get_my_personal_ranking_v1(date,integer)
  from public,anon;
grant execute on function public.get_my_personal_ranking_v1(date,integer)
  to authenticated;

comment on function public.get_my_personal_ranking_v1(date,integer) is
  'V1 personal ranking: authenticated What Matters feed contract. User identity comes only from auth.uid(); the universe is the caller''s own positions plus watchlist. No trading recommendation is produced.';
