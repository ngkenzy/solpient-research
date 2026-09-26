-- V1 §21/§22 — product analytics events + feedback taxonomy fix.
-- Additive only: new table, in-place data conversion, no table rewrite.

-- (1) analytics_events: append-only product analytics log, owner-scoped.
create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_name text not null,
  properties jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.analytics_events enable row level security;

drop policy if exists analytics_events_insert_own on public.analytics_events;
create policy analytics_events_insert_own
  on public.analytics_events
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists analytics_events_select_own on public.analytics_events;
create policy analytics_events_select_own
  on public.analytics_events
  for select to authenticated
  using (auth.uid() = user_id);

create index if not exists analytics_events_owner_event_idx
  on public.analytics_events(user_id, event_name, created_at);

-- (2) Feedback taxonomy: 'useful'/'not_useful'/'too_late'/'wrong_reason'
--     becomes 'yes'/'no' with an optional no_reason.
-- Data mapping (old -> new feedback_type / no_reason):
--   useful       -> 'yes' / null                (explicitly relevant)
--   not_useful   -> 'no'  / 'doesnt_affect_thesis' (not relevant to the user's thesis)
--   too_late     -> 'no'  / 'already_knew'      (known before it was shown)
--   wrong_reason -> 'no'  / 'wrong_interpretation' (misread the situation)
-- No data loss: in-place update, every old row maps to exactly one new row.
do $feedback_taxonomy$
declare
  v_con name;
begin
  -- Drop the original inline check constraint (auto-named by postgres);
  -- resolve it by definition rather than guessing the name.
  for v_con in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.what_matters_feedback'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike all (
        array['%''useful''%','%''not_useful''%','%''too_late''%','%''wrong_reason''%']
      )
  loop
    execute format('alter table public.what_matters_feedback drop constraint %I', v_con);
  end loop;

  if to_regclass('public.what_matters_feedback') is null then
    raise exception 'public.what_matters_feedback missing; cannot migrate feedback taxonomy';
  end if;
end $feedback_taxonomy$;

alter table public.what_matters_feedback
  add column if not exists no_reason text;

-- Convert existing rows BEFORE the new check goes in.
update public.what_matters_feedback
set
  feedback_type = case feedback_type
    when 'useful' then 'yes'
    else 'no'
  end,
  no_reason = case feedback_type
    when 'useful' then null
    when 'not_useful' then 'doesnt_affect_thesis'
    when 'too_late' then 'already_knew'
    when 'wrong_reason' then 'wrong_interpretation'
    else no_reason
  end
where feedback_type in ('useful','not_useful','too_late','wrong_reason');

alter table public.what_matters_feedback
  add constraint what_matters_feedback_type_yes_no_ck
    check (feedback_type in ('yes','no')),
  add constraint what_matters_feedback_no_reason_allowed_ck
    check (
      no_reason is null
      or no_reason in (
        'not_material','doesnt_affect_thesis','already_knew','wrong_interpretation','other'
      )
    ),
  add constraint what_matters_feedback_type_reason_coherence_ck
    check (
      (feedback_type = 'yes' and no_reason is null)
      or feedback_type = 'no'
    );
