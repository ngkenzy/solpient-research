-- Local-only compatibility bootstrap for Solpient.
-- This is intentionally permissive because every published port in the local
-- compose file is bound to 127.0.0.1. Do not reuse this role model on a VPS.

create schema if not exists extensions;
create schema if not exists auth;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

create role postgres nologin;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role solpient_dev_api nologin bypassrls;

grant solpient_dev_api to solpient;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif((coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'role'), '')
  )
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

grant usage on schema public to solpient_dev_api;
grant usage on schema auth to solpient_dev_api;
grant execute on all functions in schema auth to solpient_dev_api;

-- Restored provenance functions may be owned by the compatibility postgres role
-- and call pgcrypto/uuid functions from the extensions schema.
grant usage on schema extensions to solpient, postgres, solpient_dev_api, service_role;
grant execute on all functions in schema extensions to solpient, postgres, solpient_dev_api, service_role;

alter default privileges for role solpient in schema public
  grant select, insert, update, delete on tables to solpient_dev_api;
alter default privileges for role solpient in schema public
  grant usage, select, update on sequences to solpient_dev_api;
alter default privileges for role solpient in schema public
  grant execute on functions to solpient_dev_api;
