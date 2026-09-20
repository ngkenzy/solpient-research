alter table public.fundamental_snapshots
  add column if not exists provider text not null default 'unknown';

update public.fundamental_snapshots
set provider = coalesce(raw_payload->>'provider','unknown')
where provider = 'unknown';

alter table public.fundamental_snapshots
  drop constraint if exists fundamental_snapshots_company_id_period_end_form_key;

alter table public.fundamental_snapshots
  add constraint fundamental_snapshots_company_period_form_provider_key
  unique (company_id, period_end, form, provider);

create index if not exists fundamental_snapshots_company_provider_period_idx
  on public.fundamental_snapshots(company_id, provider, period_end desc);

comment on column public.fundamental_snapshots.provider is
  'Normalized source provider. Multiple providers may coexist for the same company and fiscal period.';