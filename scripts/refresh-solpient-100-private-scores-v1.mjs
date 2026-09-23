import process from "node:process";
import {
  closePostgresPool,
  pgMaybeOne,
  pgQuery,
  pgTransaction,
  postgresConfigured,
} from "../lib/postgres-node.mjs";
import { canonicalSha256 } from "../lib/integrity-hash.mjs";
import {
  DECISION_RANKING_METHODOLOGY_VERSION,
  READINESS_METHODOLOGY_VERSION,
  buildDecisionRanking,
  sortDecisionRankings,
} from "../lib/decision-ranking-engine.mjs";
import { applyReviewPatch } from "../lib/review-workbench.mjs";

export const SOLPIENT_100_DAILY_SCORE_VERSION =
  "solpient-100-daily-score-v1";

const n=(value)=>{
  if(value===null||value===undefined||value==="")return null;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:null;
};

function latestBy(rows,key){
  const out=new Map();
  for(const row of rows){
    const k=row?.[key];
    if(k&&!out.has(k))out.set(k,row);
  }
  return out;
}

function baseFiveYearCagr(payload={}){
  const rows=Array.isArray(payload?.expected_return_scenarios)
    ? payload.expected_return_scenarios
    : [];
  const row=rows.find((item)=>
    item?.scenario==="base"&&Number(item?.horizon_years)===5
  );
  return n(row?.expected_cagr);
}

function privateAnalysisSummary(payload={}){
  const business=payload?.business_assessment??{};
  const dashboard=payload?.decision_dashboard??{};
  return {
    summary:payload?.research?.summary??null,
    business_quality:
      dashboard?.business_quality??
      business?.business_quality_rating??
      null,
    moat:dashboard?.moat??business?.moat_rating??null,
    valuation:dashboard?.valuation??null,
    bull_thesis:business?.bull_thesis??null,
    bear_thesis:business?.bear_thesis??null,
    biggest_unknown:business?.biggest_unknown??null,
  };
}

function sourceTimestamp(source){
  const values=[
    source?.review_updated_at,
    source?.composition_generated_at,
    source?.source_cutoff_at,
    source?.draft_generated_at,
  ].filter(Boolean);
  const times=values.map((v)=>new Date(v).getTime()).filter(Number.isFinite);
  return times.length?Math.max(...times):0;
}

async function startRun(){
  const rows=await pgQuery(
    "insert into public.automation_runs(pipeline,status,details) "+
      "values('solpient_100_daily_scores_v1','running',$1::jsonb) returning id",
    [JSON.stringify({
      engine_version:SOLPIENT_100_DAILY_SCORE_VERSION,
      methodology_version:DECISION_RANKING_METHODOLOGY_VERSION,
      private:true,
    })],
  );
  return rows[0]?.id??null;
}

async function finishRun(id,status,records,message,details){
  if(!id)return;
  await pgQuery(
    "update public.automation_runs "+
      "set status=$2,records_written=$3,message=$4,details=$5::jsonb,completed_at=now() "+
      "where id=$1",
    [id,status,records,message,JSON.stringify(details??{})],
  );
}

if(!postgresConfigured()){
  throw new Error("SOLPIENT_DATABASE_URL is not configured.");
}

const runId=await startRun();

try{
  const candidateRun=await pgMaybeOne(
    "select * from public.research_candidate_pipeline_runs "+
      "order by evaluation_as_of desc nulls last,created_at desc limit 1",
  );
  if(!candidateRun)throw new Error("No Research Candidate Pipeline run exists.");
  if(Number(candidateRun.candidate_count)!==100){
    throw new Error(
      "Daily score refresh requires exactly 100 governed candidates; latest run has "+
      String(candidateRun.candidate_count)+".",
    );
  }

  const members=await pgQuery(
    "select i.ticker,i.company_id,u.shortlist_rank,u.company_name,u.sector,u.industry "+
      "from public.research_candidate_pipeline_items i "+
      "join public.universe_screen_results u on u.id=i.universe_screen_result_id "+
      "where i.research_candidate_pipeline_run_id=$1 "+
      "order by u.shortlist_rank asc nulls last,i.ticker asc",
    [candidateRun.id],
  );
  if(members.length!==100){
    throw new Error("Governed Solpient 100 snapshot is incomplete.");
  }

  const tickers=members.map((row)=>String(row.ticker).toUpperCase());
  const companies=await pgQuery(
    "select * from public.companies where upper(ticker)=any($1::text[])",
    [tickers],
  );
  const companyByTicker=new Map(
    companies.map((row)=>[String(row.ticker).toUpperCase(),row]),
  );
  const companyIds=companies.map((row)=>row.id);

  const [
    publishedRuns,
    privatePackages,
    coverages,
    markets,
  ]=await Promise.all([
    pgQuery(
      "select distinct on (company_id) * from public.research_runs "+
        "where company_id=any($1::uuid[]) and status='published' "+
        "order by company_id,version desc,researched_at desc",
      [companyIds],
    ),
    pgQuery(
      "with latest_draft as ("+
        " select distinct on (company_id) * from public.baseline_drafts "+
        " where company_id=any($1::uuid[]) and published_run_id is null "+
        " order by company_id,generated_at desc,created_at desc"+
      ") "+
      "select d.id as draft_id,d.company_id,d.draft_payload,d.source_cutoff_at,"+
        "d.generated_at as draft_generated_at,d.industry_module,"+
        "c.id as composition_id,c.composition_payload,c.validation_result,"+
        "c.generated_at as composition_generated_at,c.status as composition_status,"+
        "r.id as review_id,r.review_payload,r.status as review_status,"+
        "r.promotion_readiness,r.human_verified_at,r.updated_at as review_updated_at "+
      "from latest_draft d "+
      "left join lateral ("+
        " select * from public.research_compositions "+
        " where draft_id=d.id and engine_version='composer-v2' "+
        " and status in ('generated','applied') "+
        " order by generated_at desc limit 1"+
      ") c on true "+
      "left join public.baseline_reviews r on r.draft_id=d.id",
      [companyIds],
    ),
    pgQuery(
      "select distinct on (company_id) * from public.data_coverage_reports "+
        "where company_id=any($1::uuid[]) and engine_version='coverage-v2' "+
        "order by company_id,as_of_date desc,generated_at desc",
      [companyIds],
    ),
    pgQuery(
      "select distinct on (company_id) company_id,symbol,price,trading_date,observed_at "+
        "from public.market_snapshots "+
        "where company_id=any($1::uuid[]) and price>0 "+
        "order by company_id,trading_date desc,observed_at desc nulls last",
      [companyIds],
    ),
  ]);

  const publishedByCompany=latestBy(publishedRuns,"company_id");
  const privateByCompany=latestBy(privatePackages,"company_id");
  const coverageByCompany=latestBy(coverages,"company_id");
  const marketByCompany=latestBy(markets,"company_id");

  const publishedRunIds=publishedRuns.map((row)=>row.id);
  const [publishedScores,publishedValuations,publishedReturns]=publishedRunIds.length
    ? await Promise.all([
        pgQuery(
          "select * from public.scores where research_run_id=any($1::uuid[])",
          [publishedRunIds],
        ),
        pgQuery(
          "select * from public.valuations where research_run_id=any($1::uuid[])",
          [publishedRunIds],
        ),
        pgQuery(
          "select * from public.expected_return_scenarios "+
            "where research_run_id=any($1::uuid[]) and scenario='base' and horizon_years=5 "+
            "order by created_at desc",
          [publishedRunIds],
        ),
      ])
    : [[],[],[]];

  const scoreByRun=latestBy(publishedScores,"research_run_id");
  const valuationByRun=latestBy(publishedValuations,"research_run_id");
  const returnByRun=latestBy(publishedReturns,"research_run_id");

  const inputs=[];

  for(const member of members){
    const ticker=String(member.ticker).toUpperCase();
    const company=companyByTicker.get(ticker);
    if(!company){
      throw new Error("Canonical company identity missing for "+ticker+".");
    }

    const published=publishedByCompany.get(company.id)??null;
    const privateSource=privateByCompany.get(company.id)??null;
    const privatePatch=
      privateSource?.review_payload&&Object.keys(privateSource.review_payload).length
        ? privateSource.review_payload
        : privateSource?.composition_payload?.review_patch??null;

    let usePrivate=false;
    if(privateSource?.draft_id&&privatePatch){
      if(!published)usePrivate=true;
      else{
        const publishedAt=new Date(published.researched_at??0).getTime();
        usePrivate=sourceTimestamp(privateSource)>publishedAt;
      }
    }

    let sourceKind=published?"published":"building";
    let sourceResearchRunId=published?.id??null;
    let sourceDraftId=null;
    let sourceCompositionId=null;
    let scores={};
    let valuation={};
    let base5yCagr=null;
    let researchedAt=published?.researched_at??null;
    let analysisSummary={
      summary:published?.summary??null,
      business_quality:null,
      moat:null,
      valuation:null,
      bull_thesis:null,
      bear_thesis:null,
      biggest_unknown:null,
    };

    if(usePrivate){
      const merged=applyReviewPatch(
        privateSource.draft_payload??{},
        privatePatch??{},
      );
      sourceKind="private_review";
      sourceResearchRunId=null;
      sourceDraftId=privateSource.draft_id;
      sourceCompositionId=privateSource.composition_id??null;
      scores=merged?.scores??{};
      valuation=merged?.valuations??{};
      base5yCagr=baseFiveYearCagr(merged);
      researchedAt=
        privateSource.review_updated_at??
        privateSource.composition_generated_at??
        privateSource.draft_generated_at??
        null;
      analysisSummary=privateAnalysisSummary(merged);
    }else if(published){
      scores=scoreByRun.get(published.id)??{};
      valuation=valuationByRun.get(published.id)??{};
      base5yCagr=n(returnByRun.get(published.id)?.expected_cagr);
    }

    const market=marketByCompany.get(company.id)??null;
    const price=n(market?.price)??n(published?.price_at_research);
    const coverage=coverageByCompany.get(company.id)??{};

    const decision=buildDecisionRanking({
      scores,
      valuation,
      price,
      base5yCagr,
      coverage,
      researchedAt,
    });

    inputs.push({
      ticker,
      member,
      company,
      sourceKind,
      sourceResearchRunId,
      sourceDraftId,
      sourceCompositionId,
      scores,
      valuation,
      base5yCagr,
      price,
      coverage,
      researchedAt,
      analysisSummary,
      decision,
    });
  }

  inputs.sort(sortDecisionRankings);

  const scoredAt=new Date().toISOString();
  const rows=inputs.map((item,index)=>{
    const scoreInputs={
      engine_version:SOLPIENT_100_DAILY_SCORE_VERSION,
      candidate_pipeline_run_id:candidateRun.id,
      source:{
        kind:item.sourceKind,
        research_run_id:item.sourceResearchRunId,
        draft_id:item.sourceDraftId,
        composition_id:item.sourceCompositionId,
        researched_at:item.researchedAt,
      },
      raw_inputs:item.decision.inputs,
      business_quality:item.decision.businessQuality,
      investment_opportunity:item.decision.investmentOpportunity,
      evidence_confidence:item.decision.evidenceConfidence,
    };
    const readinessReasons={
      state:item.decision.readiness.state,
      blockers:item.decision.readiness.blockers,
      warnings:item.decision.readiness.warnings,
      decision_ready_blockers:item.decision.readiness.decisionReadyBlockers,
    };
    const snapshot={
      company_id:item.company.id,
      ticker:item.ticker,
      rank:index+1,
      source_kind:item.sourceKind,
      methodology_version:DECISION_RANKING_METHODOLOGY_VERSION,
      readiness_methodology_version:READINESS_METHODOLOGY_VERSION,
      decision_score:item.decision.decisionScore,
      business_quality_score:item.decision.businessQuality.score,
      business_quality_coverage_pct:item.decision.businessQuality.coveragePct,
      investment_opportunity_score:item.decision.investmentOpportunity.score,
      opportunity_coverage_pct:item.decision.investmentOpportunity.coveragePct,
      evidence_confidence_score:item.decision.evidenceConfidence.score,
      evidence_component_coverage_pct:item.decision.evidenceConfidence.coveragePct,
      readiness_state:item.decision.readiness.state,
      readiness_tier:item.decision.readiness.tier,
      price:item.price,
      base_fair_value:n(item.valuation?.base_value),
      score_inputs:scoreInputs,
      readiness_reasons:readinessReasons,
      analysis_summary:item.analysisSummary,
    };
    return {
      ...snapshot,
      scored_at:scoredAt,
      source_research_run_id:item.sourceResearchRunId,
      source_draft_id:item.sourceDraftId,
      source_composition_id:item.sourceCompositionId,
      snapshot_hash:canonicalSha256(snapshot),
    };
  });

  const scoredCount=rows.filter((row)=>row.decision_score!=null).length;
  const previousAt=await pgMaybeOne(
    "select max(scored_at) as scored_at from public.solpient_100_daily_scores "+
      "where methodology_version=$1",
    [DECISION_RANKING_METHODOLOGY_VERSION],
  );
  let previousFingerprint=null;
  if(previousAt?.scored_at){
    const previous=await pgQuery(
      "select company_id,rank,decision_score,business_quality_score,"+
        "investment_opportunity_score,evidence_confidence_score,readiness_state,"+
        "price,base_fair_value,snapshot_hash "+
      "from public.solpient_100_daily_scores where scored_at=$1 order by rank",
      [previousAt.scored_at],
    );
    if(previous.length===100){
      previousFingerprint=canonicalSha256(
        previous.map((row)=>({
          company_id:row.company_id,
          rank:Number(row.rank),
          snapshot_hash:row.snapshot_hash,
        })),
      );
    }
  }

  const currentFingerprint=canonicalSha256(
    rows.map((row)=>({
      company_id:row.company_id,
      rank:row.rank,
      snapshot_hash:row.snapshot_hash,
    })),
  );

  if(previousFingerprint&&previousFingerprint===currentFingerprint){
    const details={
      version:SOLPIENT_100_DAILY_SCORE_VERSION,
      companies:100,
      scored:scoredCount,
      unscored:100-scoredCount,
      state_fingerprint:currentFingerprint,
      duplicate_of_scored_at:previousAt.scored_at,
    };
    await finishRun(
      runId,
      scoredCount===100?"success":"partial",
      0,
      "Solpient 100 private daily score state is unchanged.",
      details,
    );
    console.log(JSON.stringify({...details,skipped:true},null,2));
    process.exit(0);
  }

  await pgTransaction(async(client)=>{
    for(const row of rows){
      await client.query(
        "insert into public.solpient_100_daily_scores("+
          "company_id,ticker,scored_at,rank,source_kind,source_research_run_id,"+
          "source_draft_id,source_composition_id,methodology_version,"+
          "readiness_methodology_version,decision_score,business_quality_score,"+
          "business_quality_coverage_pct,investment_opportunity_score,"+
          "opportunity_coverage_pct,evidence_confidence_score,"+
          "evidence_component_coverage_pct,readiness_state,readiness_tier,"+
          "price,base_fair_value,score_inputs,readiness_reasons,analysis_summary,"+
          "snapshot_hash"+
        ") values("+
          "$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,"+
          "$20,$21,$22::jsonb,$23::jsonb,$24::jsonb,$25"+
        ")",
        [
          row.company_id,row.ticker,row.scored_at,row.rank,row.source_kind,
          row.source_research_run_id,row.source_draft_id,row.source_composition_id,
          row.methodology_version,row.readiness_methodology_version,
          row.decision_score,row.business_quality_score,
          row.business_quality_coverage_pct,row.investment_opportunity_score,
          row.opportunity_coverage_pct,row.evidence_confidence_score,
          row.evidence_component_coverage_pct,row.readiness_state,row.readiness_tier,
          row.price,row.base_fair_value,JSON.stringify(row.score_inputs),
          JSON.stringify(row.readiness_reasons),JSON.stringify(row.analysis_summary),
          row.snapshot_hash,
        ],
      );
    }
  });

  const details={
    version:SOLPIENT_100_DAILY_SCORE_VERSION,
    candidate_pipeline_run_id:candidateRun.id,
    scored_at:scoredAt,
    companies:100,
    scored:scoredCount,
    unscored:100-scoredCount,
    private_review_sources:rows.filter((row)=>row.source_kind==="private_review").length,
    published_sources:rows.filter((row)=>row.source_kind==="published").length,
    building_sources:rows.filter((row)=>row.source_kind==="building").length,
    state_fingerprint:currentFingerprint,
    top_10:rows.slice(0,10).map((row)=>({
      rank:row.rank,
      ticker:row.ticker,
      decision_score:row.decision_score,
      readiness_state:row.readiness_state,
    })),
  };

  await finishRun(
    runId,
    scoredCount===100?"success":"partial",
    100,
    scoredCount===100
      ? "Scored all 100 governed companies with Phase 3."
      : "Daily score snapshot written, but "+String(100-scoredCount)+" companies still lack enough evidence for a Decision Score.",
    details,
  );

  console.log(JSON.stringify(details,null,2));
  // Partial coverage is reported in automation_runs; daily orchestration continues.
}catch(error){
  await finishRun(
    runId,
    "failed",
    0,
    error instanceof Error?error.message:String(error),
    {
      version:SOLPIENT_100_DAILY_SCORE_VERSION,
      methodology_version:DECISION_RANKING_METHODOLOGY_VERSION,
    },
  );
  throw error;
}finally{
  await closePostgresPool();
}
