grant select on public.valuation_history to anon, authenticated;

drop policy if exists "public read valuation history" on public.valuation_history;
create policy "public read valuation history"
on public.valuation_history for select
to anon, authenticated
using (true);
