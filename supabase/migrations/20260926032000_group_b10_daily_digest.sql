-- Group B / B10 — private daily thesis digest snapshots.
-- Digests are generated from system thesis alerts only. Users cannot insert or
-- edit digest contents directly.

create table if not exists public.thesis_digest_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  digest_date date not null,
  alert_count integer not null default 0 check (alert_count >= 0),
  highest_score integer null check (highest_score is null or highest_score between 0 and 100),
  thesis_priority_count integer not null default 0 check (thesis_priority_count >= 0),
  important_count integer not null default 0 check (important_count >= 0),
  monitor_count integer not null default 0 check (monitor_count >= 0),
  background_count integer not null default 0 check (background_count >= 0),
  digest_payload jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint thesis_digest_snapshots_user_date_key unique (user_id,digest_date)
);

create index if not exists thesis_digest_snapshots_user_date_idx
  on public.thesis_digest_snapshots(user_id,digest_date desc);

alter table public.thesis_digest_snapshots enable row level security;

revoke all on public.thesis_digest_snapshots from public,anon,authenticated;
grant select on public.thesis_digest_snapshots to authenticated;
grant all on public.thesis_digest_snapshots to service_role;

drop policy if exists "Users read own thesis digests"
  on public.thesis_digest_snapshots;
create policy "Users read own thesis digests"
on public.thesis_digest_snapshots for select
to authenticated
using ((select auth.uid())=user_id);

create or replace function consumer_private.refresh_my_daily_digest_v1(
  p_digest_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
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
    where a.user_id=v_user_id
      and a.state<>'dismissed'
      and a.created_at::date=v_digest_date
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
$$;

revoke all on function consumer_private.refresh_my_daily_digest_v1(date)
  from public,anon;
grant execute on function consumer_private.refresh_my_daily_digest_v1(date)
  to authenticated;

create or replace function public.refresh_my_daily_digest_v1(
  p_digest_date date default current_date
)
returns jsonb
language sql
volatile
security invoker
set search_path=''
as $$
  select consumer_private.refresh_my_daily_digest_v1(p_digest_date);
$$;

revoke all on function public.refresh_my_daily_digest_v1(date)
  from public,anon;
grant execute on function public.refresh_my_daily_digest_v1(date)
  to authenticated;

comment on table public.thesis_digest_snapshots is
  'Group B10 private daily digest snapshots generated from system thesis alerts. Users cannot write digest contents directly.';
comment on function public.refresh_my_daily_digest_v1(date) is
  'Group B10 authenticated in-app digest generation. No email delivery or trading recommendation.';
