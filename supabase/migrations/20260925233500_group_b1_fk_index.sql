-- Group B / B1 performance hardening.
-- Cover the composite portfolio ownership foreign key used by positions.

create index if not exists portfolio_positions_portfolio_owner_idx
  on public.portfolio_positions(portfolio_id, user_id);
