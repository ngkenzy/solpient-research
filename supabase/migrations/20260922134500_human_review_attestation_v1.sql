alter table public.baseline_reviews
  add column if not exists prepared_at timestamptz,
  add column if not exists preparation_source text,
  add column if not exists human_verified_at timestamptz,
  add column if not exists human_verified_by text,
  add column if not exists human_verified_payload_hash text,
  add column if not exists attestation_version text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'baseline_reviews_human_attestation_check') then
    alter table public.baseline_reviews
      add constraint baseline_reviews_human_attestation_check
      check (
        (human_verified_at is null and human_verified_by is null and human_verified_payload_hash is null and attestation_version is null)
        or
        (human_verified_at is not null and nullif(btrim(human_verified_by), '') is not null
          and human_verified_payload_hash ~ '^[0-9a-f]{64}$'
          and attestation_version = 'human-review-attestation-v1')
      );
  end if;
end $$;

comment on column public.baseline_reviews.prepared_at is 'When automated or analyst-assisted tooling assembled the private review package. Not proof of human verification.';
comment on column public.baseline_reviews.preparation_source is 'Origin of the prepared review package.';
comment on column public.baseline_reviews.human_verified_at is 'Explicit human attestation timestamp for the exact merged review payload.';
comment on column public.baseline_reviews.human_verified_by is 'Authorized reviewer identity or review surface that performed the explicit attestation.';
comment on column public.baseline_reviews.human_verified_payload_hash is 'SHA-256 of the canonical attestation artifact for the exact merged review payload.';
comment on column public.baseline_reviews.attestation_version is 'Version of the human review attestation contract.';

create index if not exists baseline_reviews_human_verified_at_idx
  on public.baseline_reviews(human_verified_at desc)
  where human_verified_at is not null;
