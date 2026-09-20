-- Adds an idempotent ingestion key for GitHub-driven research publishing.
alter table public.research_runs
  add column if not exists ingestion_key text;

create unique index if not exists research_runs_ingestion_key_unique
  on public.research_runs(ingestion_key)
  where ingestion_key is not null;
