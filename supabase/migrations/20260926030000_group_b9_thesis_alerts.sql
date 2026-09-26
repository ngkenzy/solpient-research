-- Group B / B9 — private thesis-alert inbox.
-- Alerts are materialized only from the authenticated user's What Matters
-- contract. Users can read and change alert state, but cannot fabricate alerts.

create table if not exists public.user_alert_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  minimum_level text not null default 'important'
    check (minimum_level in ('thesis_priority','important','monitor','background')),
  in_app_enabled boolean not null default true,
  daily_digest_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.thesis_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  position_id uuid not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  item_id text not null check (char_length(item_id) between 3 and 400),
  event_id text not null check (char_length(event_id) between 1 and 240),
  level text not null check (level in ('thesis_priority','important','monitor','background')),
  score integer not null check (score between 0 and 100),
  title text not null check (char_length(trim(title)) between 1 and 500),
  summary text null check (summary is null or char_length(summary) <= 4000),
  occurred_at timestamptz null,
  source_as_of timestamptz null,
  state text not null default 'unread'
    check (state in ('unread','read','dismissed')),
  read_at timestamptz null,
  dismissed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint thesis_alerts_position_owner_fkey
    foreign key (position_id,user_id)
    references public.portfolio_positions(id,user_id)
    on delete cascade,
  constraint thesis_alerts_user_item_key unique (user_id,item_id)
);

create index if not exists thesis_alerts_user_state_idx
  on public.thesis_alerts(user_id,state,score desc,occurred_at desc);

create index if not exists thesis_alerts_position_idx
  on public.thesis_alerts(position_id,created_at desc);

drop trigger if exists user_alert_preferences_set_updated_at
  on public.user_alert_preferences;
create trigger user_alert_preferences_set_updated_at
before update on public.user_alert_preferences
for each row execute function private.set_consumer_updated_at_v1();

drop trigger if exists thesis_alerts_set_updated_at
  on public.thesis_alerts;
create trigger thesis_alerts_set_updated_at
before update on public.thesis_alerts
for each row execute function private.set_consumer_updated_at_v1();

alter table public.user_alert_preferences enable row level security;
alter table public.thesis_alerts enable row level security;

revoke all on public.user_alert_preferences from public,anon,authenticated;
revoke all on public.thesis_alerts from public,anon,authenticated;

grant select,insert,update,delete on public.user_alert_preferences to authenticated;
grant all on public.user_alert_preferences to service_role;

grant select on public.thesis_alerts to authenticated;
grant update(state,read_at,dismissed_at) on public.thesis_alerts to authenticated;
grant all on public.thesis_alerts to service_role;

drop policy if exists "Users manage own alert preferences"
  on public.user_alert_preferences;
create policy "Users manage own alert preferences"
on public.user_alert_preferences
for all
to authenticated
using ((select auth.uid())=user_id)
with check ((select auth.uid())=user_id);

drop policy if exists "Users read own thesis alerts"
  on public.thesis_alerts;
create policy "Users read own thesis alerts"
on public.thesis_alerts for select
to authenticated
using ((select auth.uid())=user_id);

drop policy if exists "Users update own thesis alert state"
  on public.thesis_alerts;
create policy "Users update own thesis alert state"
on public.thesis_alerts for update
to authenticated
using ((select auth.uid())=user_id)
with check ((select auth.uid())=user_id);

create or replace function consumer_private.refresh_my_thesis_alerts_v1(
  p_since date default (current_date - 30),
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid:=auth.uid();
  v_contract jsonb;
  v_minimum_level text;
  v_in_app_enabled boolean;
  v_minimum_score integer;
  v_upserted integer:=0;
begin
  if v_user_id is null then
    raise exception 'Authentication required.'
      using errcode='42501';
  end if;

  insert into public.user_alert_preferences(user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select minimum_level,in_app_enabled
  into v_minimum_level,v_in_app_enabled
  from public.user_alert_preferences
  where user_id=v_user_id;

  if not coalesce(v_in_app_enabled,true) then
    return jsonb_build_object(
      'status','disabled',
      'upserted',0,
      'minimum_level',v_minimum_level
    );
  end if;

  v_minimum_score:=case v_minimum_level
    when 'thesis_priority' then 90
    when 'important' then 70
    when 'monitor' then 50
    else 0
  end;

  v_contract:=consumer_private.get_my_what_matters_v1(p_since,p_limit);

  insert into public.thesis_alerts(
    user_id,position_id,company_id,item_id,event_id,level,score,
    title,summary,occurred_at,source_as_of
  )
  select
    v_user_id,
    (item->'position'->>'id')::uuid,
    (item->'position'->>'company_id')::uuid,
    item->>'item_id',
    coalesce(nullif(item->'event'->>'event_id',''),item->>'item_id'),
    item->'user_materiality'->>'level',
    coalesce((item->'user_materiality'->>'score')::integer,0),
    coalesce(nullif(item->'event'->>'label',''),'Material thesis change'),
    nullif(item->'event'->>'summary',''),
    nullif(item->'event'->>'occurred_at','')::timestamptz,
    nullif(item->'source_freshness'->>'source_as_of','')::timestamptz
  from jsonb_array_elements(coalesce(v_contract->'items','[]'::jsonb)) item
  where coalesce((item->'user_materiality'->>'score')::integer,0)>=v_minimum_score
  on conflict (user_id,item_id) do update set
    position_id=excluded.position_id,
    company_id=excluded.company_id,
    event_id=excluded.event_id,
    level=excluded.level,
    score=excluded.score,
    title=excluded.title,
    summary=excluded.summary,
    occurred_at=excluded.occurred_at,
    source_as_of=excluded.source_as_of,
    updated_at=now();

  get diagnostics v_upserted=row_count;

  return jsonb_build_object(
    'status','ok',
    'upserted',v_upserted,
    'minimum_level',v_minimum_level,
    'generated_at',now()
  );
end
$$;

revoke all on function consumer_private.refresh_my_thesis_alerts_v1(date,integer)
  from public,anon;
grant execute on function consumer_private.refresh_my_thesis_alerts_v1(date,integer)
  to authenticated;

create or replace function public.refresh_my_thesis_alerts_v1(
  p_since date default (current_date - 30),
  p_limit integer default 100
)
returns jsonb
language sql
volatile
security invoker
set search_path=''
as $$
  select consumer_private.refresh_my_thesis_alerts_v1(p_since,p_limit);
$$;

revoke all on function public.refresh_my_thesis_alerts_v1(date,integer)
  from public,anon;
grant execute on function public.refresh_my_thesis_alerts_v1(date,integer)
  to authenticated;

comment on table public.thesis_alerts is
  'Group B9 private in-app alert inbox materialized only from the user-scoped What Matters contract.';
comment on function public.refresh_my_thesis_alerts_v1(date,integer) is
  'Group B9 authenticated alert refresh. User identity comes only from auth.uid(); no trading recommendation is produced.';
