-- Phase 2 provenance operational indexes for bounded company-level reruns.
-- These indexes do not change evidence semantics; they support the canonical
-- per-company key scans and point-in-time ordering used by the synchronizer.

create index if not exists evidence_sources_company_source_key_idx
  on public.evidence_sources(company_id, source_key);

create index if not exists evidence_observations_company_observation_key_idx
  on public.evidence_observations(company_id, observation_key);

create index if not exists evidence_observations_company_known_id_idx
  on public.evidence_observations(company_id, known_at asc, id asc);

create index if not exists normalized_facts_company_known_id_idx
  on public.normalized_facts(company_id, known_at asc, id asc);
