-- Group B / B2 — authenticated portfolio research-state contract.
-- Exposes Group A research contracts only for positions owned by auth.uid().
-- No caller-supplied user id is accepted.

create or replace function public.get_my_portfolio_research_state_v1(
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid;
  v_positions jsonb;
begin
  v_user_id:=auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required.'
      using errcode='42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'position_id',x.position_id,
        'portfolio_id',x.portfolio_id,
        'portfolio_name',x.portfolio_name,
        'company_id',x.company_id,
        'ticker',x.ticker,
        'company_name',x.company_name,
        'quantity',x.quantity,
        'average_cost',x.average_cost,
        'opened_at',x.opened_at,
        'research_contract',x.research_contract
      )
      order by x.portfolio_name,x.ticker,x.position_id
    ),
    '[]'::jsonb
  )
  into v_positions
  from (
    select
      pp.id as position_id,
      pp.portfolio_id,
      p.name as portfolio_name,
      pp.company_id,
      c.ticker,
      c.company_name,
      pp.quantity,
      pp.average_cost,
      pp.opened_at,
      public.get_company_research_contract_v1(pp.company_id,p_as_of) as research_contract
    from public.portfolio_positions pp
    join public.portfolios p
      on p.id=pp.portfolio_id
     and p.user_id=pp.user_id
    join public.companies c
      on c.id=pp.company_id
    where pp.user_id=v_user_id
  ) x;

  return jsonb_build_object(
    'contract_version','group-b-portfolio-research-state-v1',
    'as_of',p_as_of,
    'positions',v_positions
  );
end
$$;

revoke all on function public.get_my_portfolio_research_state_v1(timestamptz)
  from public,anon;

grant execute on function public.get_my_portfolio_research_state_v1(timestamptz)
  to authenticated;

comment on function public.get_my_portfolio_research_state_v1(timestamptz) is
  'Group B user-scoped portfolio research contract. Ownership is derived only from auth.uid(); Group A research tables remain private.';
