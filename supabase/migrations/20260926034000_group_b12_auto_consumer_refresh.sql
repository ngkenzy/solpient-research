-- Group B / B12 — automatic consumer-intelligence refresh.
-- Service-role-only batch orchestration. It derives each target user from
-- persisted portfolio ownership, temporarily sets the JWT subject only inside
-- the current transaction, invokes the existing B9/B10 private helpers, and
-- restores the prior JWT subject after every user.

create or replace function consumer_private.refresh_consumer_intelligence_batch_v1(
  p_user_limit integer default 200,
  p_after_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_limit integer:=least(greatest(coalesce(p_user_limit,200),1),1000);
  v_original_sub text:=current_setting('request.jwt.claim.sub',true);
  v_user record;
  v_alert_result jsonb;
  v_digest_result jsonb;
  v_results jsonb:='[]'::jsonb;
  v_processed integer:=0;
  v_alert_ready integer:=0;
  v_digest_ready integer:=0;
  v_error_count integer:=0;
  v_last_user_id uuid;
begin
  if current_user<>'postgres' and current_user<>'service_role' then
    raise exception 'Service role required.'
      using errcode='42501';
  end if;

  for v_user in
    select distinct pp.user_id
    from public.portfolio_positions pp
    where (p_after_user_id is null or pp.user_id>p_after_user_id)
    order by pp.user_id
    limit v_limit
  loop
    v_processed:=v_processed+1;
    v_last_user_id:=v_user.user_id;

    begin
      perform set_config('request.jwt.claim.sub',v_user.user_id::text,true);

      v_alert_result:=consumer_private.refresh_my_thesis_alerts_v1(
        current_date-30,
        100
      );

      if coalesce(v_alert_result->>'status','')='ok' then
        v_alert_ready:=v_alert_ready+1;
      end if;

      v_digest_result:=consumer_private.refresh_my_daily_digest_v1(
        current_date
      );

      if coalesce(v_digest_result->>'status','')='ready' then
        v_digest_ready:=v_digest_ready+1;
      end if;

      v_results:=v_results||jsonb_build_array(jsonb_build_object(
        'user_id',v_user.user_id,
        'alert_status',v_alert_result->>'status',
        'alerts_upserted',coalesce((v_alert_result->>'upserted')::integer,0),
        'digest_status',v_digest_result->>'status'
      ));
    exception
      when others then
        v_error_count:=v_error_count+1;
        v_results:=v_results||jsonb_build_array(jsonb_build_object(
          'user_id',v_user.user_id,
          'status','failed',
          'sqlstate',sqlstate,
          'message',sqlerrm
        ));
    end;

    perform set_config(
      'request.jwt.claim.sub',
      coalesce(v_original_sub,''),
      true
    );
  end loop;

  perform set_config(
    'request.jwt.claim.sub',
    coalesce(v_original_sub,''),
    true
  );

  return jsonb_build_object(
    'contract_version','group-b-consumer-refresh-batch-v1',
    'processed_users',v_processed,
    'alert_refresh_ok',v_alert_ready,
    'digest_refresh_ready',v_digest_ready,
    'error_count',v_error_count,
    'last_user_id',v_last_user_id,
    'has_more',v_processed=v_limit,
    'results',v_results,
    'completed_at',now()
  );
end
$$;

revoke all on function consumer_private.refresh_consumer_intelligence_batch_v1(integer,uuid)
  from public,anon,authenticated;
grant execute on function consumer_private.refresh_consumer_intelligence_batch_v1(integer,uuid)
  to service_role;

create or replace function public.refresh_consumer_intelligence_batch_v1(
  p_user_limit integer default 200,
  p_after_user_id uuid default null
)
returns jsonb
language sql
volatile
security invoker
set search_path=''
as $$
  select consumer_private.refresh_consumer_intelligence_batch_v1(
    p_user_limit,
    p_after_user_id
  );
$$;

revoke all on function public.refresh_consumer_intelligence_batch_v1(integer,uuid)
  from public,anon,authenticated;
grant execute on function public.refresh_consumer_intelligence_batch_v1(integer,uuid)
  to service_role;

comment on function public.refresh_consumer_intelligence_batch_v1(integer,uuid) is
  'Group B12 service-role-only batch refresh for B9 alerts and B10 daily digests. Never exposed to consumer roles.';
