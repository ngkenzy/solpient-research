-- Group B / B14 — per-position attention controls.
-- Global alert settings remain defaults. Position settings may only narrow or
-- mute attention further and control digest inclusion.

create table if not exists public.position_attention_preferences (
  position_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  attention_enabled boolean not null default true,
  minimum_level text not null default 'important'
    check (minimum_level in ('thesis_priority','important','monitor','background')),
  digest_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint position_attention_preferences_position_owner_fkey
    foreign key (position_id,user_id)
    references public.portfolio_positions(id,user_id)
    on delete cascade
);

create index if not exists position_attention_preferences_user_idx
  on public.position_attention_preferences(user_id,updated_at desc);

drop trigger if exists position_attention_preferences_set_updated_at
  on public.position_attention_preferences;
create trigger position_attention_preferences_set_updated_at
before update on public.position_attention_preferences
for each row execute function private.set_consumer_updated_at_v1();

alter table public.position_attention_preferences enable row level security;

revoke all on public.position_attention_preferences from public,anon,authenticated;
grant select,insert,update,delete on public.position_attention_preferences to authenticated;
grant all on public.position_attention_preferences to service_role;

drop policy if exists "Users manage own position attention"
  on public.position_attention_preferences;
create policy "Users manage own position attention"
on public.position_attention_preferences
for all
to authenticated
using ((select auth.uid())=user_id)
with check ((select auth.uid())=user_id);

create or replace function private.consumer_attention_level_score_v1(p_level text)
returns integer
language sql
immutable
set search_path=''
as $$
  select case coalesce(p_level,'important')
    when 'thesis_priority' then 90
    when 'important' then 70
    when 'monitor' then 50
    else 0
  end;
$$;

revoke all on function private.consumer_attention_level_score_v1(text)
  from public,anon,authenticated;

create or replace function consumer_private.materialize_my_thesis_alerts_v1(
  p_since date default (current_date - 30),
  p_limit integer default 100,
  p_respect_in_app boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $b14_alert$
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

  if coalesce(p_respect_in_app,true)
     and not coalesce(v_in_app_enabled,true) then
    return jsonb_build_object(
      'status','disabled',
      'upserted',0,
      'minimum_level',v_minimum_level
    );
  end if;

  v_minimum_score:=private.consumer_attention_level_score_v1(v_minimum_level);

  v_contract:=consumer_private.get_my_what_matters_v1(
    coalesce(p_since,current_date-30),
    least(greatest(coalesce(p_limit,100),1),200)
  );

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
  left join public.position_attention_preferences pap
    on pap.position_id=(item->'position'->>'id')::uuid
   and pap.user_id=v_user_id
  where coalesce(pap.attention_enabled,true)
    and coalesce((item->'user_materiality'->>'score')::integer,0)>=greatest(
      v_minimum_score,
      private.consumer_attention_level_score_v1(pap.minimum_level)
    )
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
$b14_alert$;

create or replace function consumer_private.refresh_my_daily_digest_v1(
  p_digest_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $b14_digest$
declare
  v_user_id uuid:=auth.uid();
  v_digest_date date:=coalesce(p_digest_date,current_date);
  v_digest_enabled boolean;
  v_alert_count integer:=0;
  v_highest_score integer;
  v_priority_count integer:=0;
  v_important_count integer:=0;
  v_monitor_count integer:=0;
  v_background_count integer:=0;
  v_payload jsonb:='{}'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required.'
      using errcode='42501';
  end if;

  insert into public.user_alert_preferences(user_id)
  values(v_user_id)
  on conflict(user_id) do nothing;

  select daily_digest_enabled
  into v_digest_enabled
  from public.user_alert_preferences
  where user_id=v_user_id;

  if not coalesce(v_digest_enabled,false) then
    return jsonb_build_object(
      'status','disabled',
      'digest_date',v_digest_date
    );
  end if;

  with eligible as (
    select a.*
    from public.thesis_alerts a
    left join public.position_attention_preferences pap
      on pap.position_id=a.position_id
     and pap.user_id=a.user_id
    where a.user_id=v_user_id
      and a.state<>'dismissed'
      and a.created_at::date=v_digest_date
      and coalesce(pap.attention_enabled,true)
      and coalesce(pap.digest_enabled,true)
  ),
  counts as (
    select
      count(*)::integer as alert_count,
      max(score)::integer as highest_score,
      count(*) filter(where level='thesis_priority')::integer as thesis_priority_count,
      count(*) filter(where level='important')::integer as important_count,
      count(*) filter(where level='monitor')::integer as monitor_count,
      count(*) filter(where level='background')::integer as background_count
    from eligible
  ),
  top_items as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'alert_id',id,
          'position_id',position_id,
          'company_id',company_id,
          'item_id',item_id,
          'event_id',event_id,
          'level',level,
          'score',score,
          'title',title,
          'summary',summary,
          'occurred_at',occurred_at,
          'source_as_of',source_as_of
        )
        order by score desc,coalesce(occurred_at,created_at) desc,id
      ),
      '[]'::jsonb
    ) as items
    from (
      select *
      from eligible
      order by score desc,coalesce(occurred_at,created_at) desc,id
      limit 20
    ) ranked
  )
  select
    c.alert_count,
    c.highest_score,
    c.thesis_priority_count,
    c.important_count,
    c.monitor_count,
    c.background_count,
    jsonb_build_object(
      'contract_version','group-b-daily-thesis-digest-v1',
      'digest_date',v_digest_date,
      'generated_at',now(),
      'counts',jsonb_build_object(
        'alerts',c.alert_count,
        'thesis_priority',c.thesis_priority_count,
        'important',c.important_count,
        'monitor',c.monitor_count,
        'background',c.background_count
      ),
      'items',t.items
    )
  into
    v_alert_count,
    v_highest_score,
    v_priority_count,
    v_important_count,
    v_monitor_count,
    v_background_count,
    v_payload
  from counts c
  cross join top_items t;

  insert into public.thesis_digest_snapshots(
    user_id,digest_date,alert_count,highest_score,
    thesis_priority_count,important_count,monitor_count,background_count,
    digest_payload,generated_at
  ) values (
    v_user_id,v_digest_date,coalesce(v_alert_count,0),v_highest_score,
    coalesce(v_priority_count,0),coalesce(v_important_count,0),
    coalesce(v_monitor_count,0),coalesce(v_background_count,0),
    coalesce(v_payload,'{}'::jsonb),now()
  )
  on conflict(user_id,digest_date) do update set
    alert_count=excluded.alert_count,
    highest_score=excluded.highest_score,
    thesis_priority_count=excluded.thesis_priority_count,
    important_count=excluded.important_count,
    monitor_count=excluded.monitor_count,
    background_count=excluded.background_count,
    digest_payload=excluded.digest_payload,
    generated_at=excluded.generated_at;

  return jsonb_build_object(
    'status','ready',
    'digest_date',v_digest_date,
    'alert_count',coalesce(v_alert_count,0),
    'highest_score',v_highest_score
  );
end
$b14_digest$;

comment on table public.position_attention_preferences is
  'Group B14 private per-position attention controls. Position settings may narrow or mute global alert/digest attention.';
