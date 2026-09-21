alter table public.thesis_variables
  drop constraint if exists thesis_variables_status_check;

alter table public.thesis_variables
  add constraint thesis_variables_status_check
  check (status = any (array[
    'strengthened'::text,
    'unchanged'::text,
    'weakened'::text,
    'unknown'::text,
    'monitor'::text
  ]));
