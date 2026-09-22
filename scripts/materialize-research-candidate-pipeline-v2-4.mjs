import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { buildMethodologyImplementationFingerprint } from "../lib/methodology-implementation-hash.mjs";
import {
  RESEARCH_CANDIDATE_PIPELINE_VERSION,
  buildResearchCandidatePipeline,
} from "../lib/research-candidate-pipeline-v2-4.mjs";
import {
  RESEARCH_CANDIDATE_MATERIALIZATION_PROTOCOL_VERSION,
  buildCandidateSourceSnapshot,
  buildCandidatePipelineInputHash,
  buildCandidateItemHash,
  publishResearchCandidatePipelineStaged,
} from "../lib/research-candidate-materialization-v1.mjs";
import { VALUATION_METHODOLOGY_VERSION } from "../lib/valuation-engine-v3.mjs";
import { UNIVERSE_SCREENING_VERSION } from "../lib/universe-screening-engine.mjs";
import { READINESS_METHODOLOGY_VERSION } from "../lib/decision-ranking-engine.mjs";

function arg(name,fallback=null){
  const prefix="--"+name+"=";
  const found=process.argv.find(x=>x.startsWith(prefix));
  return found?found.slice(prefix.length):fallback;
}

const screenRunId=arg("screen-run-id",process.env.UNIVERSE_SCREEN_RUN_ID??null);
const asOfArg=arg("as-of",process.env.CANDIDATE_PIPELINE_AS_OF??null);
if(!screenRunId){
  throw new Error(
    "Provide --screen-run-id=<immutable universe screen run UUID>. "+
    "Research Candidate Pipeline V2.4 never selects a screen run by 'latest'."
  );
}

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

const {data:screenRun,error:screenRunError}=await sb.from("universe_screen_runs")
  .select("*")
  .eq("id",screenRunId)
  .maybeSingle();
if(screenRunError)throw screenRunError;
if(!screenRun)throw new Error("Universe screening run not found: "+screenRunId);
if(screenRun.methodology_version!==UNIVERSE_SCREENING_VERSION){
  throw new Error(
    "Research Candidate Pipeline "+RESEARCH_CANDIDATE_PIPELINE_VERSION+
    " requires "+UNIVERSE_SCREENING_VERSION+
    "; selected universe screen is "+screenRun.methodology_version+"."
  );
}

const evaluationAsOf=new Date(asOfArg??screenRun.as_of_at);
if(!Number.isFinite(evaluationAsOf.getTime())){
  throw new Error("Invalid evaluation as-of timestamp.");
}
const evaluationAsOfIso=evaluationAsOf.toISOString();
const evaluationAsOfDate=evaluationAsOfIso.slice(0,10);

const {count:actualScreenCount,error:screenCountError}=await sb
  .from("universe_screen_results")
  .select("id",{count:"exact",head:true})
  .eq("universe_screen_run_id",screenRun.id);
if(screenCountError)throw screenCountError;
if(actualScreenCount!==screenRun.result_count){
  throw new Error(
    "Selected universe screen run is incomplete: expected "+screenRun.result_count+
    " results, found "+actualScreenCount+"."
  );
}

const {data:screenRows,error:screenError}=await sb.from("universe_screen_results")
  .select("*")
  .eq("universe_screen_run_id",screenRun.id)
  .eq("proposed_for_deep_research",true)
  .order("shortlist_rank",{ascending:true})
  .order("ticker",{ascending:true});
if(screenError)throw screenError;
if((screenRows??[]).length!==screenRun.proposed_deep_research_count){
  throw new Error(
    "Deep-research shortlist is incomplete: expected "+
    screenRun.proposed_deep_research_count+" rows, found "+(screenRows??[]).length+"."
  );
}

const requiredMethodologies=[
  {methodology_key:"research_candidate_pipeline",version:RESEARCH_CANDIDATE_PIPELINE_VERSION,requireImplementationHash:true},
  {methodology_key:"universe_screening",version:UNIVERSE_SCREENING_VERSION,requireImplementationHash:true},
  {methodology_key:"valuation_v3",version:VALUATION_METHODOLOGY_VERSION,requireImplementationHash:false},
  {methodology_key:"decision_readiness",version:READINESS_METHODOLOGY_VERSION,requireImplementationHash:false},
];
const keys=[...new Set(requiredMethodologies.map(x=>x.methodology_key))];
const {data:definitions,error:definitionsError}=await sb.from("methodology_definitions")
  .select("*")
  .in("methodology_key",keys);
if(definitionsError)throw definitionsError;
const definitionIds=(definitions??[]).map(x=>x.id);
const {data:events,error:eventsError}=definitionIds.length
  ?await sb.from("methodology_lifecycle_events").select("*")
    .in("methodology_definition_id",definitionIds)
  :{data:[],error:null};
if(eventsError)throw eventsError;

function latestEvent(definitionId){
  return (events??[])
    .filter(x=>x.methodology_definition_id===definitionId)
    .sort((a,b)=>{
      const t=String(b.effective_at??b.created_at??"")
        .localeCompare(String(a.effective_at??a.created_at??""));
      if(t!==0)return t;
      return String(b.created_at??"").localeCompare(String(a.created_at??""));
    })[0]??null;
}

const activeStack=[];
for(const required of requiredMethodologies){
  const def=(definitions??[]).find(
    x=>x.methodology_key===required.methodology_key&&x.version===required.version
  );
  if(!def){
    throw new Error(
      "Required methodology is not registered: "+
      required.methodology_key+" "+required.version
    );
  }
  const active=latestEvent(def.id);
  if(active?.event_type!=="active"){
    throw new Error(
      "Required methodology is not ACTIVE: "+
      required.methodology_key+" "+required.version
    );
  }
  if(required.requireImplementationHash){
    const current=buildMethodologyImplementationFingerprint(def.manifest??def);
    if(!def.implementation_hash||def.implementation_hash!==current.implementation_hash){
      throw new Error(
        "Methodology implementation drift detected: "+
        required.methodology_key+" "+required.version
      );
    }
    if(active?.metadata?.implementation_hash!==def.implementation_hash){
      throw new Error(
        "ACTIVE methodology event is not bound to its implementation hash: "+
        required.methodology_key+" "+required.version
      );
    }
  }
  activeStack.push({
    methodology_key:required.methodology_key,
    version:required.version,
    definition_id:def.id,
    implementation_hash:def.implementation_hash??null,
    activation_commit_sha:active.commit_sha??null,
    active_metadata:active.metadata??{},
  });
}

const activePipeline=activeStack.find(x=>x.methodology_key==="research_candidate_pipeline");
const activeScreen=activeStack.find(x=>x.methodology_key==="universe_screening");
if(activeScreen?.active_metadata?.validation_hash!==screenRun?.metadata?.validation_hash||
   activeScreen?.active_metadata?.universe_input_hash!==screenRun?.metadata?.universe_input_hash){
  throw new Error(
    "Selected universe screen run is not bound to the currently active screening validation bundle."
  );
}

const tickers=(screenRows??[]).map(r=>String(r.ticker).toUpperCase());
const {data:companies,error:companiesError}=tickers.length
  ?await sb.from("companies").select("id,ticker,company_name").in("ticker",tickers)
  :{data:[],error:null};
if(companiesError)throw companiesError;
const companyByTicker=new Map((companies??[]).map(r=>[String(r.ticker).toUpperCase(),r]));
const companyIds=(companies??[]).map(r=>r.id);

const [
  {data:packs,error:packsError},
  {data:runs,error:runsError},
  {data:coverageRows,error:coverageError},
]=await Promise.all([
  tickers.length
    ?sb.from("candidate_valuation_input_packs").select("*")
      .in("ticker",tickers)
      .eq("status","reviewed")
      .lte("reviewed_at",evaluationAsOfIso)
      .order("reviewed_at",{ascending:false})
    :Promise.resolve({data:[],error:null}),
  companyIds.length
    ?sb.from("research_runs")
      .select("id,company_id,researched_at,status,price_at_research")
      .in("company_id",companyIds)
      .eq("status","published")
      .lte("researched_at",evaluationAsOfIso)
      .order("researched_at",{ascending:false})
    :Promise.resolve({data:[],error:null}),
  companyIds.length
    ?sb.from("data_coverage_reports").select("*")
      .in("company_id",companyIds)
      .eq("engine_version","coverage-v2")
      .lte("as_of_date",evaluationAsOfDate)
      .lte("generated_at",evaluationAsOfIso)
      .order("as_of_date",{ascending:false})
      .order("generated_at",{ascending:false})
    :Promise.resolve({data:[],error:null}),
]);
for(const error of [packsError,runsError,coverageError])if(error)throw error;

const screenResultIdByTicker=new Map(
  (screenRows??[]).map(r=>[String(r.ticker).toUpperCase(),r.id])
);
const packByTicker=new Map();
for(const row of packs??[]){
  const ticker=String(row.ticker).toUpperCase();
  if(packByTicker.has(ticker))continue;
  const currentScreenResultId=screenResultIdByTicker.get(ticker);
  if(row.universe_screen_result_id&&row.universe_screen_result_id!==currentScreenResultId){
    continue;
  }
  packByTicker.set(ticker,row);
}

const runByCompany=new Map();
for(const row of runs??[]){
  if(!runByCompany.has(row.company_id))runByCompany.set(row.company_id,row);
}
const coverageByCompany=new Map();
for(const row of coverageRows??[]){
  if(!coverageByCompany.has(row.company_id))coverageByCompany.set(row.company_id,row);
}

const researchRunIds=[...runByCompany.values()].map(r=>r.id);
const {data:scores,error:scoresError}=researchRunIds.length
  ?await sb.from("scores").select("*").in("research_run_id",researchRunIds)
  :{data:[],error:null};
if(scoresError)throw scoresError;
const scoreByRun=new Map((scores??[]).map(r=>[r.research_run_id,r]));

const sources=[];
const outputs=[];
for(const row of screenRows??[]){
  const ticker=String(row.ticker).toUpperCase();
  const company=companyByTicker.get(ticker)??null;
  const researchRun=company?runByCompany.get(company.id)??null:null;
  const coverage=company?coverageByCompany.get(company.id)??null:null;
  const scoreRow=researchRun?scoreByRun.get(researchRun.id)??null:null;
  const pack=packByTicker.get(ticker)??null;

  const valuationInput={...(pack?.valuation_input??{})};
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
    sectorClassification:row?.score_detail?.sector_classification??null,
    proposedForDeepResearch:row.proposed_for_deep_research,
    methodologyVersion:screenRun.methodology_version,
  };

  const researchInput={
    scores:{
      quality_score:scoreRow?.quality_score??null,
      moat_score:scoreRow?.moat_score??null,
      financial_strength_score:scoreRow?.financial_strength_score??null,
      overall_score:scoreRow?.overall_score??null,
    },
    coverage:coverage??{},
    researchedAt:researchRun?.researched_at??null,
  };

  const source=buildCandidateSourceSnapshot({
    screenResult:row,
    company,
    researchRun,
    coverage,
    scoreRow,
    valuationPack:pack,
    valuationInput,
    researchInput,
    evaluationAsOf:evaluationAsOfIso,
  });

  const output=buildResearchCandidatePipeline({
    evaluationAsOf:evaluationAsOfIso,
    screenResult,
    companyExists:Boolean(company),
    valuationInput,
    researchInput,
  });

  sources.push({
    ticker,
    source_snapshot_hash:source.source_snapshot_hash,
    screen_result_id:row.id,
    screen_result_hash:row.result_hash,
    company_id:company?.id??null,
    research_run_id:researchRun?.id??null,
    coverage_id:coverage?.id??null,
    valuation_input_pack_id:pack?.id??null,
    valuation_input_hash:pack?.input_hash??null,
    score_id:scoreRow?.id??null,
  });
  outputs.push({
    row,company,researchRun,pack,source,output,
  });
}

const inputHash=buildCandidatePipelineInputHash({
  pipelineVersion:RESEARCH_CANDIDATE_PIPELINE_VERSION,
  valuationMethodologyVersion:VALUATION_METHODOLOGY_VERSION,
  readinessMethodologyVersion:READINESS_METHODOLOGY_VERSION,
  universeScreenRunId:screenRun.id,
  universeScreenInputHash:screenRun.input_hash,
  screenValidationHash:screenRun?.metadata?.validation_hash??null,
  universeInputHash:screenRun?.metadata?.universe_input_hash??null,
  evaluationAsOf:evaluationAsOfIso,
  activeImplementationHash:activePipeline?.implementation_hash??null,
  sources,
});

const counts={
  decision_ready:outputs.filter(x=>x.output.stage==="decision_ready").length,
  research_ready:outputs.filter(x=>x.output.stage==="research_ready").length,
  building:outputs.filter(x=>x.output.stage==="research_building").length,
  onboarding:outputs.filter(x=>x.output.stage==="onboarding").length,
  valuation_building:outputs.filter(x=>x.output.stage==="valuation_building").length,
};

const items=outputs.map(({row,company,researchRun,pack,source,output})=>{
  const payload={
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
    source_snapshot_hash:source.source_snapshot_hash,
    source_snapshot:source.snapshot,
    next_actions:output.nextActions,
    pipeline_output:output,
  };
  return{...payload,item_hash:buildCandidateItemHash(payload)};
});

const runPayload={
  universe_screen_run_id:screenRun.id,
  pipeline_version:RESEARCH_CANDIDATE_PIPELINE_VERSION,
  valuation_methodology_version:VALUATION_METHODOLOGY_VERSION,
  readiness_methodology_version:READINESS_METHODOLOGY_VERSION,
  evaluation_as_of:evaluationAsOfIso,
  input_hash:inputHash,
  candidate_count:outputs.length,
  decision_ready_count:counts.decision_ready,
  research_ready_count:counts.research_ready,
  building_count:counts.building,
  onboarding_count:counts.onboarding,
  valuation_building_count:counts.valuation_building,
  metadata:{
    materialization_protocol_version:RESEARCH_CANDIDATE_MATERIALIZATION_PROTOCOL_VERSION,
    universe_screen_input_hash:screenRun.input_hash,
    screen_validation_hash:screenRun?.metadata?.validation_hash??null,
    universe_input_hash:screenRun?.metadata?.universe_input_hash??null,
    screen_as_of_at:screenRun.as_of_at,
    active_methodology_stack:activeStack,
    pipeline_implementation_hash:activePipeline?.implementation_hash??null,
    candidate_source_hashes:sources.map(x=>({
      ticker:x.ticker,
      source_snapshot_hash:x.source_snapshot_hash,
    })),
    atomic_publication:true,
  },
};

const {data:existing,error:existingError}=await sb
  .from("research_candidate_pipeline_runs")
  .select("id,created_at,candidate_count")
  .eq("input_hash",inputHash)
  .maybeSingle();
if(existingError)throw existingError;
if(existing){
  const {count,error}=await sb.from("research_candidate_pipeline_items")
    .select("id",{count:"exact",head:true})
    .eq("research_candidate_pipeline_run_id",existing.id);
  if(error)throw error;
  if(count!==existing.candidate_count){
    throw new Error("Existing candidate pipeline run is incomplete.");
  }
  console.log(JSON.stringify({
    skipped:true,
    reason:"identical_input_hash",
    run_id:existing.id,
    input_hash:inputHash,
    candidate_count:existing.candidate_count,
    published_item_count:count,
    evaluation_as_of:evaluationAsOfIso,
  },null,2));
  process.exit(0);
}

const publication=await publishResearchCandidatePipelineStaged({
  sb,
  runPayload,
  items,
});

const {count:publishedItemCount,error:countError}=await sb
  .from("research_candidate_pipeline_items")
  .select("id",{count:"exact",head:true})
  .eq("research_candidate_pipeline_run_id",publication.runId);
if(countError)throw countError;
if(publishedItemCount!==items.length){
  throw new Error(
    "Post-publication verification failed: expected "+items.length+
    " items, found "+publishedItemCount+"."
  );
}

console.log(JSON.stringify({
  run_id:publication.runId,
  input_hash:inputHash,
  universe_screen_run_id:screenRun.id,
  pipeline_version:RESEARCH_CANDIDATE_PIPELINE_VERSION,
  evaluation_as_of:evaluationAsOfIso,
  candidate_count:outputs.length,
  counts,
  stages:Object.fromEntries(
    [...new Set(outputs.map(x=>x.output.stage))].map(stage=>[
      stage,outputs.filter(x=>x.output.stage===stage).length
    ])
  ),
  materialized:true,
  atomic_publication:true,
  publication_transport:"staged-v2.4",
  staged_chunk_count:publication.stagedChunkCount,
  published_item_count:publishedItemCount,
},null,2));
