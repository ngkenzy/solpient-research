-- Group B / B15 follow-up — make account deletion compatible with B12
-- append-only thesis-factor history.
--
-- A normal factor DELETE must still append audit history. During auth.users
-- deletion, however, the user row may already be absent when the cascading
-- position_thesis_factors DELETE trigger fires. In that case, writing a new
-- history row would violate position_thesis_factor_history_user_id_fkey.
-- Skip only that terminal account-deletion audit write.

create or replace function private.record_position_thesis_factor_history_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $b15_account_delete$
declare
  v_row public.position_thesis_factors;
  v_company_id uuid;
  v_event_type text;
begin
  if tg_op='DELETE'
     and not exists (
       select 1
       from auth.users u
       where u.id=old.user_id
     ) then
    return old;
  end if;

  if tg_op='UPDATE'
     and new.source_type is not distinct from old.source_type
     and new.canonical_thesis_variable_id is not distinct from old.canonical_thesis_variable_id
     and new.factor_key is not distinct from old.factor_key
     and new.factor_label is not distinct from old.factor_label
     and new.importance is not distinct from old.importance
     and new.personal_expectation is not distinct from old.personal_expectation
     and new.personal_breaker_condition is not distinct from old.personal_breaker_condition
     and new.enabled is not distinct from old.enabled then
    return new;
  end if;

  if tg_op='DELETE' then
    v_row:=old;
    v_event_type:='factor_removed';
  elsif tg_op='INSERT' then
    v_row:=new;
    v_event_type:='factor_added';
  else
    v_row:=new;
    v_event_type:='factor_updated';
  end if;

  select pp.company_id
  into v_company_id
  from public.portfolio_positions pp
  where pp.id=v_row.position_id
    and pp.user_id=v_row.user_id;

  insert into public.position_thesis_factor_history(
    user_id,position_id,company_id,factor_id,source_type,
    canonical_thesis_variable_id,factor_key,factor_label,event_type,
    importance_before,importance_after,
    personal_expectation_before,personal_expectation_after,
    personal_breaker_before,personal_breaker_after,
    enabled_before,enabled_after,changed_at,metadata
  ) values (
    v_row.user_id,
    v_row.position_id,
    v_company_id,
    v_row.id,
    v_row.source_type,
    v_row.canonical_thesis_variable_id,
    v_row.factor_key,
    v_row.factor_label,
    v_event_type,
    case when tg_op in ('UPDATE','DELETE') then old.importance else null end,
    case when tg_op in ('INSERT','UPDATE') then new.importance else null end,
    case when tg_op in ('UPDATE','DELETE') then old.personal_expectation else null end,
    case when tg_op in ('INSERT','UPDATE') then new.personal_expectation else null end,
    case when tg_op in ('UPDATE','DELETE') then old.personal_breaker_condition else null end,
    case when tg_op in ('INSERT','UPDATE') then new.personal_breaker_condition else null end,
    case when tg_op in ('UPDATE','DELETE') then old.enabled else null end,
    case when tg_op in ('INSERT','UPDATE') then new.enabled else null end,
    clock_timestamp(),
    jsonb_build_object(
      'history_version','group-b-thesis-factor-history-v1',
      'recorded_from_trigger',true
    )
  );

  if tg_op='DELETE' then return old; end if;
  return new;
end
$b15_account_delete$;

revoke all on function private.record_position_thesis_factor_history_v1()
  from public,anon,authenticated;
