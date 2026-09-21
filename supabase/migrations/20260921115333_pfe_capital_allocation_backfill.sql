-- Pfizer historical capital-allocation backfill.
-- Values are USD and reflect reported cash-flow statement items.
-- Sources:
-- 2021: Pfizer 2022 Form 10-K
-- 2022-2024: Pfizer 2024 Form 10-K
-- 2025: Pfizer 2025 Form 10-K

with pfe as (select id from public.companies where ticker='PFE'),
rows(metric_key,label,period_end,fiscal_year,value_numeric,source_title,source_url) as (
  values
  ('dividends_paid','Cash dividends paid','2021-12-31'::date,2021,8729000000::numeric,'Pfizer 2022 Form 10-K','https://www.sec.gov/Archives/edgar/data/78003/000007800323000024/pfe-20221231.htm'),
  ('buybacks','Share repurchases','2021-12-31',2021,0,'Pfizer 2022 Form 10-K','https://www.sec.gov/Archives/edgar/data/78003/000007800323000024/pfe-20221231.htm'),
  ('acquisitions','Business acquisitions, net of cash acquired','2021-12-31',2021,0,'Pfizer 2022 Form 10-K','https://www.sec.gov/Archives/edgar/data/78003/000007800323000024/pfe-20221231.htm'),
  ('debt_issued','Long-term debt issued','2021-12-31',2021,997000000,'Pfizer 2022 Form 10-K','https://www.sec.gov/Archives/edgar/data/78003/000007800323000024/pfe-20221231.htm'),
  ('debt_repaid','Long-term debt repaid','2021-12-31',2021,2004000000,'Pfizer 2022 Form 10-K','https://www.sec.gov/Archives/edgar/data/78003/000007800323000024/pfe-20221231.htm'),
  ('dividends_paid','Cash dividends paid','2022-12-31',2022,8983000000,'Pfizer 2024 Form 10-K','https://www.sec.gov/Archives/edgar/data/78003/000007800325000054/pfe-20241231.htm'),
  ('buybacks','Share repurchases','2022-12-31',2022,2000000000,'Pfizer 2024 Form 10-K','https://www.sec.gov/Archives/edgar/data/78003/000007800325000054/pfe-20241231.htm'),
  ('acquisitions','Business acquisitions, net of cash acquired','2022-12-31',2022,22997000000,'Pfizer 2024 Form 10-K','https://www.sec.gov/Archives/edgar/data/78003/000007800325000054/pfe-20241231.htm'),
  ('debt_issued','Long-term debt issued','2022-12-31',2022,0,'Pfizer 2024 Form 10-K','https://www.sec.gov/Archives/edgar/data/78003/000007800325000054/pfe-20241231.htm'),
  ('debt_repaid','Long-term debt repaid','2022-12-31',2022,3298000000,'Pfizer 2024 Form 10-K','https://www.sec.gov/Archives/edgar/data/78003/000007800325000054/pfe-20241231.htm'),
  ('dividends_paid','Cash dividends paid','2023-12-31',2023,9247000000,'Pfizer 2024 Form 10-K','https://www.sec.gov/Archives/edgar/data/78003/000007800325000054/pfe-20241231.htm'),
  ('buybacks','Share repurchases','2023-12-31',2023,0,'Pfizer 2024 Form 10-K','https://www.sec.gov/Archives/edgar/data/78003/000007800325000054/pfe-20241231.htm'),
  ('acquisitions','Business acquisitions, net of cash acquired','2023-12-31',2023,43430000000,'Pfizer 2024 Form 10-K','https://www.sec.gov/Archives/edgar/data/78003/000007800325000054/pfe-20241231.htm'),
  ('debt_issued','Long-term debt issued','2023-12-31',2023,30831000000,'Pfizer 2024 Form 10-K','https://www.sec.gov/Archives/edgar/data/78003/000007800325000054/pfe-20241231.htm'),
  ('debt_repaid','Long-term debt repaid','2023-12-31',2023,2569000000,'Pfizer 2024 Form 10-K','https://www.sec.gov/Archives/edgar/data/78003/000007800325000054/pfe-20241231.htm'),
  ('dividends_paid','Cash dividends paid','2024-12-31',2024,9512000000,'Pfizer 2024 Form 10-K','https://www.sec.gov/Archives/edgar/data/78003/000007800325000054/pfe-20241231.htm'),
  ('buybacks','Share repurchases','2024-12-31',2024,0,'Pfizer 2024 Form 10-K','https://www.sec.gov/Archives/edgar/data/78003/000007800325000054/pfe-20241231.htm'),
  ('acquisitions','Business acquisitions, net of cash acquired','2024-12-31',2024,0,'Pfizer 2024 Form 10-K','https://www.sec.gov/Archives/edgar/data/78003/000007800325000054/pfe-20241231.htm'),
  ('debt_issued','Long-term debt issued','2024-12-31',2024,0,'Pfizer 2024 Form 10-K','https://www.sec.gov/Archives/edgar/data/78003/000007800325000054/pfe-20241231.htm'),
  ('debt_repaid','Long-term debt repaid','2024-12-31',2024,2250000000,'Pfizer 2024 Form 10-K','https://www.sec.gov/Archives/edgar/data/78003/000007800325000054/pfe-20241231.htm'),
  ('buybacks','Share repurchases','2025-12-31',2025,0,'Pfizer 2025 Form 10-K','https://www.sec.gov/Archives/edgar/data/78003/000007800326000026/pfe-20251231.htm'),
  ('acquisitions','Business acquisitions, net of cash acquired','2025-12-31',2025,6927000000,'Pfizer 2025 Form 10-K','https://www.sec.gov/Archives/edgar/data/78003/000007800326000026/pfe-20251231.htm'),
  ('debt_issued','Long-term debt issued','2025-12-31',2025,9678000000,'Pfizer 2025 Form 10-K','https://www.sec.gov/Archives/edgar/data/78003/000007800326000026/pfe-20251231.htm'),
  ('debt_repaid','Long-term debt repaid','2025-12-31',2025,6757000000,'Pfizer 2025 Form 10-K','https://www.sec.gov/Archives/edgar/data/78003/000007800326000026/pfe-20251231.htm')
)
insert into public.company_metric_history (
  company_id,module,metric_key,label,period_end,fiscal_year,period_type,
  value_numeric,unit,basis,source_type,source_title,source_url,observed_at
)
select pfe.id,'universal',r.metric_key,r.label,r.period_end,r.fiscal_year,'fiscal_year',
       r.value_numeric,'USD','reported','10-K',r.source_title,r.source_url,now()
from pfe cross join rows r
on conflict (company_id,module,metric_key,period_end,period_type)
do update set
  label=excluded.label,
  fiscal_year=excluded.fiscal_year,
  value_numeric=excluded.value_numeric,
  unit=excluded.unit,
  basis=excluded.basis,
  source_type=excluded.source_type,
  source_title=excluded.source_title,
  source_url=excluded.source_url,
  observed_at=excluded.observed_at;
