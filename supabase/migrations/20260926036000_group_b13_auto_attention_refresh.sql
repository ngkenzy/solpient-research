-- Group B / B13 — automatic consumer attention refresh.
-- Reuses the existing authenticated What Matters / alert / digest contracts by
-- temporarily setting auth.uid() inside a service-role-only security-definer batch.
-- No consumer identity is exposed to public callers.

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
as $b13_alert$
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

  v_minimum_score:=case v_minimum_level
    when 'thesis_priority' then 90
    when 'important' then 70
    when 'monitor' then 50
    else 0
  end;

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
$b13_alert$;

revoke all on function consumer_private.materialize_my_thesis_alerts_v1(date,integer,boolean)
  from public,anon,authenticated,service_role;

create or replace function consumer_private.refresh_my_thesis_alerts_v1(
  p_since date default (current_date - 30),
  p_limit integer default 100
)
returns jsonb
language sql
volatile
security definer
set search_path=''
as $b13_refresh$
  select consumer_private.materialize_my_thesis_alerts_v1(
    p_since,p_limit,true
  );
$b13_refresh$;

revoke all on function consumer_private.refresh_my_thesis_alerts_v1(date,integer)
  from public,anon;
grant execute on function consumer_private.refresh_my_thesis_alerts_v1(date,integer)
  to authenticated;

create or replace function consumer_private.refresh_consumer_attention_batch_v1(
  p_since date default (current_date - 30),
  p_digest_date date default current_date,
  p_limit integer default 200
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $$
declare
  v_since date:=coalesce(p_since,current_date-30);
  v_digest_date date:=coalesce(p_digest_date,current_date);
  v_limit integer:=least(greatest(coalesce(p_limit,200),1),1000);
  v_original_sub text:=current_setting('request.jwt.claim.sub',true);
  v_row record;
  v_alert_result jsonb;
  v_digest_result jsonb;
  v_users_processed integer:=0;
  v_alerts_upserted integer:=0;
  v_digests_ready integer:=0;
  v_failures integer:=0;
begin
  for v_row in
    select
      users.user_id,
      coalesce(pref.in_app_enabled,true) as in_app_enabled,
      coalesce(pref.daily_digest_enabled,false) as daily_digest_enabled
    from (
      select distinct pp.user_id
      from public.portfolio_positions pp
    ) users
    left join public.user_alert_preferences pref
      on pref.user_id=users.user_id
    order by users.user_id
    limit v_limit
  loop
    begin
      perform set_config('request.jwt.claim.sub',v_row.user_id::text,true);

      if v_row.in_app_enabled or v_row.daily_digest_enabled then
        v_alert_result:=consumer_private.materialize_my_thesis_alerts_v1(
          v_since,
          200,
          not v_row.daily_digest_enabled
        );
        v_alerts_upserted:=v_alerts_upserted+
          coalesce((v_alert_result->>'upserted')::integer,0);
      end if;

      if v_row.daily_digest_enabled then
        v_digest_result:=consumer_private.refresh_my_daily_digest_v1(
          v_digest_date
        );
        if v_digest_result->>'status'='ready' then
          v_digests_ready:=v_digests_ready+1;
        end if;
      end if;

      v_users_processed:=v_users_processed+1;
    exception
      when others then
        v_failures:=v_failures+1;
    end;
  end loop;

  perform set_config(
    'request.jwt.claim.sub',
    coalesce(v_original_sub,''),
    true
  );

  return jsonb_build_object(
    'contract_version','group-b-consumer-attention-batch-v1',
    'status',case when v_failures=0 then 'ok' else 'partial' end,
    'since',v_since,
    'digest_date',v_digest_date,
    'users_processed',v_users_processed,
    'alerts_upserted',v_alerts_upserted,
    'digests_ready',v_digests_ready,
    'failures',v_failures,
    'completed_at',now()
  );
end
$$;

revoke all on function consumer_private.refresh_consumer_attention_batch_v1(date,date,integer)
  from public,anon,authenticated;
grant usage on schema consumer_private to service_role;
grant execute on function consumer_private.refresh_consumer_attention_batch_v1(date,date,integer)
  to service_role;

create or replace function public.refresh_consumer_attention_batch_v1(
  p_since date default (current_date - 30),
  p_digest_date date default current_date,
  p_limit integer default 200
)
returns jsonb
language sql
volatile
security invoker
set search_path=''
as $$
  select consumer_private.refresh_consumer_attention_batch_v1(
    p_since,p_digest_date,p_limit
  );
$$;

revoke all on function public.refresh_consumer_attention_batch_v1(date,date,integer)
  from public,anon,authenticated;
grant execute on function public.refresh_consumer_attention_batch_v1(date,date,integer)
  to service_role;

comment on function public.refresh_consumer_attention_batch_v1(date,date,integer) is
  'Group B13 service-role-only batch that materializes private thesis alerts and enabled daily digests for portfolio users.';
