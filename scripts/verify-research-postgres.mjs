import { closePostgresPool, pgMaybeOne, postgresConfigured } from "../lib/postgres-node.mjs";

if(!postgresConfigured()){
  throw new Error("SOLPIENT_DATABASE_URL is not configured. Run npm run local:configure-app first.");
}

try{
  const sample=await pgMaybeOne(`
    select c.id as company_id,c.ticker,r.id as research_run_id,r.standard_version
    from public.companies c
    join lateral (
      select id,standard_version
      from public.research_runs
      where company_id=c.id and status='published'
      order by version desc
      limit 1
    ) r on true
    order by c.ticker
    limit 1
  `);

  if(!sample)throw new Error("No published research run found in local PostgreSQL.");

  const checks=await pgMaybeOne(`
    select
      (select count(*)::int from public.companies) as companies,
      (select count(*)::int from public.capital_activity where company_id=$1) as capital_activity,
      (select count(*)::int from public.peer_metric_snapshots where company_id=$1) as peer_metrics,
      (select count(*)::int from public.data_coverage_reports where company_id=$1) as coverage_reports,
      (select count(*)::int from public.decision_triggers where company_id=$1) as decision_triggers,
      (select count(*)::int from public.company_change_events where company_id=$1) as company_changes,
      (select count(*)::int from public.expected_return_scenarios where research_run_id=$2) as expected_returns,
      (select count(*)::int from public.risk_register where research_run_id=$2) as risks,
      (select count(*)::int from public.financial_metrics where research_run_id=$2) as financial_metrics,
      (select count(*)::int from public.metric_observations where research_run_id=$2) as standard_v1_metrics,
      (select count(*)::int from public.research_v2_sections where research_run_id=$2) as standard_v2_sections
  `,[sample.company_id,sample.research_run_id]);

  console.log(JSON.stringify({
    ok:true,
    mode:"postgres",
    connection_source:"project-.env.local",
    sampleTicker:sample.ticker,
    standardVersion:sample.standard_version,
    ...checks,
  },null,2));
}finally{
  await closePostgresPool();
}
