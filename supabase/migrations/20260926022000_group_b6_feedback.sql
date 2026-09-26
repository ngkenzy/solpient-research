-- Group B / B6 — What Matters feedback and missed-event reporting.

create table if not exists public.what_matters_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  position_id uuid not null,
  item_id text not null check (char_length(item_id) between 3 and 400),
  event_id text not null check (char_length(event_id) between 1 and 240),
  feedback_type text not null check (
    feedback_type in ('useful','not_useful','too_late','wrong_reason')
  ),
  note text null check (note is null or char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint what_matters_feedback_position_owner_fkey
    foreign key (position_id,user_id)
    references public.portfolio_positions(id,user_id)
    on delete cascade,
  constraint what_matters_feedback_user_item_key
    unique (user_id,item_id)
);

create index if not exists what_matters_feedback_position_idx
  on public.what_matters_feedback(position_id,updated_at desc);

create table if not exists public.what_matters_missed_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  position_id uuid not null,
  expected_event text not null check (char_length(trim(expected_event)) between 3 and 1000),
  note text null check (note is null or char_length(note) <= 3000),
  occurred_on date null,
  status text not null default 'reported'
    check (status in ('reported','reviewed','dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint what_matters_missed_events_position_owner_fkey
    foreign key (position_id,user_id)
    references public.portfolio_positions(id,user_id)
    on delete cascade
);

create index if not exists what_matters_missed_events_user_idx
  on public.what_matters_missed_events(user_id,created_at desc);

drop trigger if exists what_matters_feedback_set_updated_at
  on public.what_matters_feedback;
create trigger what_matters_feedback_set_updated_at
before update on public.what_matters_feedback
for each row execute function private.set_consumer_updated_at_v1();

drop trigger if exists what_matters_missed_events_set_updated_at
  on public.what_matters_missed_events;
create trigger what_matters_missed_events_set_updated_at
before update on public.what_matters_missed_events
for each row execute function private.set_consumer_updated_at_v1();

alter table public.what_matters_feedback enable row level security;
alter table public.what_matters_missed_events enable row level security;

revoke all on public.what_matters_feedback from public,anon;
revoke all on public.what_matters_missed_events from public,anon;

grant select,insert,update,delete on public.what_matters_feedback to authenticated;
grant select,insert,update,delete on public.what_matters_missed_events to authenticated;
grant all on public.what_matters_feedback to service_role;
grant all on public.what_matters_missed_events to service_role;

drop policy if exists "Users manage own What Matters feedback"
  on public.what_matters_feedback;
create policy "Users manage own What Matters feedback"
on public.what_matters_feedback
for all
to authenticated
using ((select auth.uid())=user_id)
with check ((select auth.uid())=user_id);

drop policy if exists "Users manage own missed-event reports"
  on public.what_matters_missed_events;
create policy "Users manage own missed-event reports"
on public.what_matters_missed_events
for all
to authenticated
using ((select auth.uid())=user_id)
with check ((select auth.uid())=user_id);

comment on table public.what_matters_feedback is
  'Group B6 private user feedback on What Matters items. No public/social semantics.';
comment on table public.what_matters_missed_events is
  'Group B6 private reports of events the user expected What Matters to surface.';
