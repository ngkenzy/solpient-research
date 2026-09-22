import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { canonicalSha256, CANONICALIZATION_VERSION } from "../lib/integrity-hash.mjs";
import {
  RESEARCH_CANDIDATE_PIPELINE_VERSION,
  buildResearchCandidatePipeline,
} from "../lib/research-candidate-pipeline.mjs";
import { VALUATION_METHODOLOGY_VERSION } from "../lib/valuation-engine-v3.mjs";
import { UNIVERSE_SCREENING_VERSION } from "../lib/universe-screening-engine.mjs";
import { READINESS_METHODOLOGY_VERSION } from "../lib/decision-ranking-engine.mjs";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

const {data:screenRun,error:screenRunError}=await sb.from("universe_screen_runs")
  .select("*")
  .order("as_of_at",{ascending:false})
  .order("created_at",{ascending:false})
  .limit(1)
  .maybeSingle();
if(screenRunError)throw screenRunError;
if(!screenRun)throw new Error("No universe screening run exists.");
if(screenRun.methodology_version!==UNIVERSE_SCREENING_VERSION){
  throw new Error(
    "Research Candidate Pipeline "+RESEARCH_CANDIDATE_PIPELINE_VERSION+
    " requires "+UNIVERSE_SCREENING_VERSION+
    "; latest universe screen is "+screenRun.methodology_version+"."
  );
}

const {data:screenRows,error:screenError}=await sb.from("universe_screen_results")
  .select("*")
  .eq("universe_screen_run_id",screenRun.id)
  .eq("proposed_for_deep_research",true)
  .order("shortlist_rank",{ascending:true});
if(screenError)throw screenError;

const tickers=(screenRows??[]).map(r=>r.ticker);
const {data:companies,error:companiesError}=tickers.length
  ?await sb.from("companies").select("id,ticker,company_name").in("ticker",tickers)
  :{data:[],error:null};
if(companiesError)throw companiesError;
const companyByTicker=new Map((companies??[]).map(r=>[String(r.ticker).toUpperCase(),r]));
const companyIds=(companies??[]).map(r=>r.id);

const [{data:packs,error:packsError},{data:runs,error:runsError},{data:coverageRows,error:coverageError}]=await Promise.all([
  tickers.length
    ?sb.from("candidate_valuation_input_packs").select("*").in("ticker",tickers).eq("status","reviewed").order("reviewed_at",{ascending:false})
    :Promise.resolve({data:[],error:null}),
  companyIds.length
    ?sb.from("research_runs").select("id,company_id,researched_at,status,price_at_research").in("company_id",companyIds).eq("status","published").order("researched_at",{ascending:false})
    :Promise.resolve({data:[],error:null}),
  companyIds.length
    ?sb.from("data_coverage_reports").select("*").in("company_id",companyIds).eq("engine_version","coverage-v2").order("as_of_date",{ascending:false}).order("generated_at",{ascending:false})
    :Promise.resolve({data:[],error:null}),
]);
for(const e of [packsError,runsError,coverageError])if(e)throw e;

const packByTicker=new Map();
for(const row of packs??[])if(!packByTicker.has(String(row.ticker).toUpperCase()))packByTicker.set(String(row.ticker).toUpperCase(),row);

const runByCompany=new Map();
for(const row of runs??[])if(!runByCompany.has(row.company_id))runByCompany.set(row.company_id,row);

const coverageByCompany=new Map();
for(const row of coverageRows??[])if(!coverageByCompany.has(row.company_id))coverageByCompany.set(row.company_id,row);

const researchRunIds=[...runByCompany.values()].map(r=>r.id);
const {data:scores,error:scoresError}=researchRunIds.length
  ?await sb.from("scores").select("*").in("research_run_id",researchRunIds)
  :{data:[],error:null};
if(scoresError)throw scoresError;
const scoreByRun=new Map((scores??[]).map(r=>[r.research_run_id,r]));

const sourceInputs=[];
const outputs=[];
for(const row of screenRows??[]){
  const symbol=String(row.ticker).toUpperCase();
  const company=companyByTicker.get(symbol)??null;
  const researchRun=company?runByCompany.get(company.id)??null:null;
  const coverage=company?coverageByCompany.get(company.id)??{}:{};
  const scoreRow=researchRun?scoreByRun.get(researchRun.id)??{}:{};
  const pack=packByTicker.get(symbol)??null;
  const valuationInput={
    ...(pack?.valuation_input??{}),
  };
  if(valuationInput.currentPrice==null&&row?.input_summary?.price!=null){
    valuationInput.currentPrice=Number(row.input_summary.price);
  }

  const screenResult={
    ticker:row.ticker,
    company_name:row.company_name,
    profile:row.screen_profile,
    state:row.screen_state,
    screenScore:row.screen_score,
    qualityCoreScore:row.quality_core_score,
    rawEvidenceCoveragePct:row?.score_detail?.raw_evidence_coverage_pct??null,
    evidenceCoveragePct:row.evidence_coverage_pct,
    sectorEvidence:row?.score_detail?.sector_evidence??null,
    proposedForDeepResearch:row.proposed_for_deep_research,
    methodologyVersion:screenRun.methodology_version,
  };

  const researchInput={
    scores:{
      quality_score:scoreRow.quality_score,
      moat_score:scoreRow.moat_score,
      financial_strength_score:scoreRow.financial_strength_score,
      overall_score:scoreRow.overall_score,
    },
    coverage,
    researchedAt:researchRun?.researched_at??null,
  };

  const output=buildResearchCandidatePipeline({
    screenResult,
    companyExists:Boolean(company),
    valuationInput,
    researchInput,
  });

  sourceInputs.push({
    screen_result_id:row.id,
    ticker:symbol,
    company_id:company?.id??null,
    research_run_id:researchRun?.id??null,
    coverage_id:coverage?.id??null,
    valuation_input_pack_id:pack?.id??null,
    valuation_input_hash:pack?.input_hash??null,
    score_id:scoreRow?.id??null,
  });
  outputs.push({row,company,researchRun,coverage,pack,output});
}

const inputHash=canonicalSha256({
  canonicalization_version:CANONICALIZATION_VERSION,
  pipeline_version:RESEARCH_CANDIDATE_PIPELINE_VERSION,
  valuation_methodology_version:VALUATION_METHODOLOGY_VERSION,
  readiness_methodology_version:READINESS_METHODOLOGY_VERSION,
  universe_screen_run_id:screenRun.id,
  sources:sourceInputs,
});

const {data:existing,error:existingError}=await sb.from("research_candidate_pipeline_runs")
  .select("id,created_at")
  .eq("input_hash",inputHash)
  .maybeSingle();
if(existingError)throw existingError;
if(existing){
  console.log(JSON.stringify({skipped:true,reason:"identical_input_hash",run_id:existing.id,created_at:existing.created_at},null,2));
  process.exit(0);
}

const counts={
  decision_ready:outputs.filter(x=>x.output.stage==="decision_ready").length,
  research_ready:outputs.filter(x=>x.output.stage==="research_ready").length,
  building:outputs.filter(x=>["research_building"].includes(x.output.stage)).length,
  onboarding:outputs.filter(x=>x.output.stage==="onboarding").length,
  valuation_building:outputs.filter(x=>x.output.stage==="valuation_building").length,
};

const {data:pipelineRun,error:pipelineRunError}=await sb.from("research_candidate_pipeline_runs").insert({
  universe_screen_run_id:screenRun.id,
  pipeline_version:RESEARCH_CANDIDATE_PIPELINE_VERSION,
  valuation_methodology_version:VALUATION_METHODOLOGY_VERSION,
  readiness_methodology_version:READINESS_METHODOLOGY_VERSION,
  input_hash:inputHash,
  candidate_count:outputs.length,
  decision_ready_count:counts.decision_ready,
  research_ready_count:counts.research_ready,
  building_count:counts.building,
  onboarding_count:counts.onboarding,
  valuation_building_count:counts.valuation_building,
}).select("id").single();
if(pipelineRunError)throw pipelineRunError;

const items=outputs.map(({row,company,researchRun,pack,output})=>{
  const payload={
    research_candidate_pipeline_run_id:pipelineRun.id,
    universe_screen_result_id:row.id,
    ticker:row.ticker,
    company_id:company?.id??null,
    research_run_id:researchRun?.id??null,
    valuation_input_pack_id:pack?.id??null,
    stage:output.stage,
    readiness_state:output.readiness.state,
    valuation_preflight_complete:Boolean(output.valuation.preflight.complete),
    valuation_base_fair_value:output.valuation.result?.base_fair_value??null,
    valuation_confidence:output.valuation.result?.confidence?.score??null,
    valuation_confidence_band:output.valuation.result?.confidence?.band??null,
    base_5y_cagr:output.valuation.base5yCagr??null,
    decision_score:output.readiness.decision?.decisionScore??null,
    evidence_confidence:output.readiness.decision?.evidenceConfidence?.score??null,
    next_actions:output.nextActions,
    pipeline_output:output,
  };
  return{...payload,item_hash:canonicalSha256(payload)};
});

for(let i=0;i<items.length;i+=100){
  const {error}=await sb.from("research_candidate_pipeline_items").insert(items.slice(i,i+100));
  if(error)throw error;
}

console.log(JSON.stringify({
  run_id:pipelineRun.id,
  input_hash:inputHash,
  candidate_count:outputs.length,
  counts,
  stages:Object.fromEntries([...new Set(outputs.map(x=>x.output.stage))].map(stage=>[
    stage,outputs.filter(x=>x.output.stage===stage).length
  ])),
},null,2));
