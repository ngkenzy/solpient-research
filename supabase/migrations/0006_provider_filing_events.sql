-- SOLPIENT provider-backed filing intelligence
create table if not exists public.filing_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null,
  form_type text not null,
  filed_at date not null,
  accepted_at timestamptz,
  accession_number text,
  filing_url text,
  period_end date,
  title text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(company_id, provider, form_type, filed_at, accession_number)
);

create index if not exists filing_events_company_date_idx
  on public.filing_events(company_id, filed_at desc);

alter table public.filing_events enable row level security;

create policy "public read filing events"
  on public.filing_events for select using (true);

comment on table public.filing_events is
  'Provider-backed filing metadata used to trigger research/thesis refresh workflows.';
