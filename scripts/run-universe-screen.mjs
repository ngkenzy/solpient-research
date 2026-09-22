import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import {
  buildMethodologyValidationBundle,
  SCREEN_MATERIALIZATION_STACK,
  methodologyStackStatus,
  METHODOLOGY_ACTIVATION_VERSION,
} from "../lib/methodology-activation-v1.mjs";
import { buildMethodologyImplementationFingerprint } from "../lib/methodology-implementation-hash.mjs";
import { canonicalSha256, CANONICALIZATION_VERSION } from "../lib/integrity-hash.mjs";
import {
  UNIVERSE_SCREENING_VERSION,
  UNIVERSE_SELECTION_VERSION,
  SCREEN_STATE,
  selectSolpient100Candidates,
} from "../lib/universe-screening-engine.mjs";

function arg(name, fallback=null){
  const prefix="--"+name+"=";
  const found=process.argv.find(x=>x.startsWith(prefix));
  return found?found.slice(prefix.length):fallback;
}
const inputPath=arg("input",process.env.UNIVERSE_INPUT_PATH??null);
const dryRun=process.argv.includes("--dry-run");
const acknowledgeReviewItems=process.argv.includes("--acknowledge-review-items");
const acknowledgeClassificationReviewQueue=process.argv.includes("--acknowledge-classification-review-queue");
const limit=Math.max(1,Number(arg("limit",process.env.SOLPIENT_100_LIMIT??100))||100);
const minInputCount=Math.max(1,Number(arg("min-input-count","1000"))||1000);
const providerArg=arg("provider",process.env.UNIVERSE_PROVIDER??null);
const asOfArg=arg("as-of",process.env.UNIVERSE_AS_OF_AT??null);

if(!inputPath)throw new Error("Provide --input=/path/to/universe.json or UNIVERSE_INPUT_PATH.");

function parseInput(filePath){
  const raw=fs.readFileSync(filePath,"utf8");
  const ext=path.extname(filePath).toLowerCase();
  if(ext===".jsonl"||ext===".ndjson"){
    const rows=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map((line,i)=>{
      try{return JSON.parse(line);}
      catch(error){throw new Error("Invalid JSONL at line "+(i+1)+": "+error.message);}
    });
    return{rows,metadata:{}};
  }
  const parsed=JSON.parse(raw);
  if(Array.isArray(parsed))return{rows:parsed,metadata:{}};
  if(Array.isArray(parsed.securities))return{
    rows:parsed.securities,
    metadata:{
      provider:parsed.provider??null,
      as_of_at:parsed.as_of_at??null,
      source_version:parsed.source_version??null,
      universe_name:parsed.universe_name??null,
    },
  };
  throw new Error("Universe input must be a JSON array, JSONL/NDJSON, or an object with a securities array.");
}

const parsed=parseInput(inputPath);
const tickers=new Set();
for(const [index,row] of parsed.rows.entries()){
  const ticker=String(row?.ticker??"").trim().toUpperCase();
  if(!ticker)throw new Error("Universe row "+(index+1)+" is missing ticker.");
  if(tickers.has(ticker))throw new Error("Duplicate ticker in universe input: "+ticker);
  tickers.add(ticker);
}

const provider=providerArg??parsed.metadata.provider??"unknown-provider";
const requestedAsOf=asOfArg??parsed.metadata.as_of_at??null;
if(!dryRun&&!requestedAsOf){
  throw new Error(
    "Production materialization requires an explicit --as-of timestamp or input metadata.as_of_at. "+
    "A current-time fallback is not allowed for immutable screening history."
  );
}
if(requestedAsOf&&!Number.isFinite(new Date(requestedAsOf).getTime())){
  throw new Error("Invalid as-of timestamp: "+requestedAsOf);
}
const asOfAt=requestedAsOf?new Date(requestedAsOf).toISOString():null;

const normalizedRows=[...parsed.rows]
  .map(row=>({...row,ticker:String(row.ticker).trim().toUpperCase()}))
  .sort((a,b)=>a.ticker.localeCompare(b.ticker));

const validationBundle=buildMethodologyValidationBundle(normalizedRows,{
  limit,
  minInputCount,
  acknowledgeReviewItems,
  acknowledgeClassificationReviewQueue,
});
const screened=selectSolpient100Candidates(normalizedRows,{limit});
const inputHash=canonicalSha256({
  methodology_version:UNIVERSE_SCREENING_VERSION,
  selection_version:UNIVERSE_SELECTION_VERSION,
  canonicalization_version:CANONICALIZATION_VERSION,
  provider,
  as_of_at:asOfAt,
  limit,
  min_input_count:minInputCount,
  activation_version:METHODOLOGY_ACTIVATION_VERSION,
  validation_hash:validationBundle.validation_hash,
  universe_input_hash:validationBundle.universe_input_hash,
  rows:normalizedRows,
});

const counts={
  excluded:screened.filter(r=>r.state===SCREEN_STATE.EXCLUDED).length,
  watch:screened.filter(r=>r.state===SCREEN_STATE.WATCH).length,
  research_candidate:screened.filter(r=>r.state===SCREEN_STATE.RESEARCH_CANDIDATE).length,
  solpient_100_candidate:screened.filter(r=>r.state===SCREEN_STATE.SOLPIENT_100_CANDIDATE).length,
  solpient_100:screened.filter(r=>r.state===SCREEN_STATE.SOLPIENT_100).length,
  proposed_deep_research:screened.filter(r=>r.proposedForDeepResearch).length,
};

const preview={
  methodology_version:UNIVERSE_SCREENING_VERSION,
  selection_version:UNIVERSE_SELECTION_VERSION,
  provider,
  as_of_at:asOfAt,
  input_hash:inputHash,
  universe_input_hash:validationBundle.universe_input_hash,
  input_count:normalizedRows.length,
  min_input_count:minInputCount,
  counts,
  validation_gate:{
    ready:validationBundle.ready,
    validation_hash:validationBundle.validation_hash,
    universe_input_hash:validationBundle.universe_input_hash,
    qa_status:validationBundle.qa_status,
    qa_blockers:validationBundle.qa_blockers,
    qa_review_items:validationBundle.qa_review_items,
    classification_review_required_count:validationBundle.classification.review_required_count,
    classification_review_queue:validationBundle.classification.review_queue,
    classification_unresolved_count:validationBundle.classification.unresolved_count,
    classification_obvious_unknown_count:validationBundle.classification.obvious_unknown_count,
    blocking_reasons:validationBundle.blocking_reasons,
    acceptance:validationBundle.acceptance,
  },
  top:screened.slice(0,Math.min(25,screened.length)).map(r=>({
    rank:r.universeRank,
    ticker:r.ticker,
    state:r.state,
    score:r.screenScore,
    quality:r.qualityCoreScore,
    coverage:r.evidenceCoveragePct,
    raw_coverage:r.rawEvidenceCoveragePct,
    evidence_ceiling:r.sectorEvidence?.evidenceCoverageCeilingPct??100,
    critical_sector_evidence:r.sectorEvidence?.criticalEvidenceCoveragePct??null,
    shortlist_rank:r.shortlistRank,
    proposed_for_deep_research:r.proposedForDeepResearch,
  })),
};

if(dryRun){
  console.log(JSON.stringify(preview,null,2));
  process.exit(0);
}

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret for materialization.");
if(!validationBundle.ready){
  throw new Error(
    "Universe materialization blocked by validation gate: "+
    validationBundle.blocking_reasons.join(" ")
  );
}
const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

const stackKeys=[...new Set(SCREEN_MATERIALIZATION_STACK.map(x=>x.methodology_key))];
const {data:methodologyDefinitions,error:methodologyDefinitionsError}=await sb
  .from("methodology_definitions")
  .select("*")
  .in("methodology_key",stackKeys);
if(methodologyDefinitionsError)throw methodologyDefinitionsError;

const methodologyDefinitionIds=(methodologyDefinitions??[]).map(x=>x.id);
const {data:methodologyEvents,error:methodologyEventsError}=methodologyDefinitionIds.length
  ?await sb.from("methodology_lifecycle_events").select("*").in("methodology_definition_id",methodologyDefinitionIds)
  :{data:[],error:null};
if(methodologyEventsError)throw methodologyEventsError;

const activeStack=methodologyStackStatus(
  methodologyDefinitions??[],
  methodologyEvents??[],
  SCREEN_MATERIALIZATION_STACK
);
if(!activeStack.ready){
  throw new Error(
    "Universe materialization requires the exact active methodology stack. Missing="+
    activeStack.missing.join(",")+" inactive="+JSON.stringify(activeStack.inactive)
  );
}

for(const row of activeStack.rows){
  const def=(methodologyDefinitions??[]).find(d=>d.id===row.definition_id);
  const currentFingerprint=buildMethodologyImplementationFingerprint(def?.manifest??def);
  if(!row.implementation_hash||
     row.implementation_hash!==currentFingerprint.implementation_hash){
    throw new Error(
      "Universe materialization blocked by implementation drift: "+
      row.methodology_key+" "+row.version
    );
  }
  if(row.active_event?.metadata?.implementation_hash!==row.implementation_hash){
    throw new Error(
      "Active methodology event is not bound to its implementation hash: "+
      row.methodology_key+" "+row.version
    );
  }
  if(row.active_event?.metadata?.validation_hash!==validationBundle.validation_hash||
     row.active_event?.metadata?.universe_input_hash!==validationBundle.universe_input_hash){
    throw new Error(
      "Universe materialization input does not match the exact bundle used for methodology activation: "+
      row.methodology_key+" "+row.version
    );
  }
}

const {data:existing,error:existingError}=await sb
  .from("universe_screen_runs")
  .select("id,as_of_at,input_count")
  .eq("input_hash",inputHash)
  .maybeSingle();
if(existingError)throw existingError;
if(existing){
  console.log(JSON.stringify({
    skipped:true,
    reason:"identical_input_hash",
    existing_run_id:existing.id,
    input_hash:inputHash,
    input_count:existing.input_count,
    as_of_at:existing.as_of_at,
  },null,2));
  process.exit(0);
}

const resultRows=screened.map(result=>{
  const payload={
    ticker:result.ticker,
    company_name:result.companyName,
    sector:result.sector,
    industry:result.industry,
    screen_profile:result.profile,
    screen_state:result.state,
    universe_rank:result.universeRank,
    shortlist_rank:result.shortlistRank,
    proposed_for_deep_research:result.proposedForDeepResearch,
    final_membership_requires_review:result.finalMembershipRequiresReview,
    screen_score:result.screenScore,
    quality_core_score:result.qualityCoreScore,
    evidence_coverage_pct:result.evidenceCoveragePct,
    quality_score:result.dimensions.quality.score,
    durability_score:result.dimensions.durability.score,
    balance_sheet_score:result.dimensions.balanceSheet.score,
    growth_score:result.dimensions.growth.score,
    valuation_score:result.dimensions.valuation.score,
    gates:result.gates,
    reasons:result.reasons,
    score_detail:{
      dimensions:result.dimensions,
      sector_evidence:result.sectorEvidence,
      sector_classification:result.sectorClassification,
      sector_taxonomy_version:result.sectorTaxonomyVersion,
      raw_evidence_coverage_pct:result.rawEvidenceCoveragePct,
      effective_evidence_coverage_pct:result.evidenceCoveragePct,
      methodology_version:result.methodologyVersion,
      sector_evidence_model_version:result.sectorEvidenceModelVersion,
    },
    input_summary:result.input,
  };
  return{...payload,result_hash:canonicalSha256(payload)};
});

const runPayload={
  as_of_at:asOfAt,
  methodology_version:UNIVERSE_SCREENING_VERSION,
  selection_version:UNIVERSE_SELECTION_VERSION,
  provider,
  input_hash:inputHash,
  input_count:normalizedRows.length,
  result_count:resultRows.length,
  excluded_count:counts.excluded,
  watch_count:counts.watch,
  research_candidate_count:counts.research_candidate,
  solpient_100_candidate_count:counts.solpient_100_candidate,
  proposed_deep_research_count:counts.proposed_deep_research,
  metadata:{
    source_version:parsed.metadata.source_version,
    universe_name:parsed.metadata.universe_name,
    canonicalization_version:CANONICALIZATION_VERSION,
    shortlist_limit:limit,
    minimum_universe_size:minInputCount,
    sector_evidence_model_version:screened[0]?.sectorEvidenceModelVersion??null,
    methodology_activation_version:METHODOLOGY_ACTIVATION_VERSION,
    validation_hash:validationBundle.validation_hash,
    universe_input_hash:validationBundle.universe_input_hash,
    qa_version:validationBundle.qa_version,
    qa_status:validationBundle.qa_status,
    qa_blockers:validationBundle.qa_blockers,
    qa_review_items:validationBundle.qa_review_items,
    classification_review_required_count:validationBundle.classification.review_required_count,
    classification_unresolved_count:validationBundle.classification.unresolved_count,
    classification_obvious_unknown_count:validationBundle.classification.obvious_unknown_count,
    active_methodology_stack:activeStack.rows.map(x=>({
      methodology_key:x.methodology_key,
      version:x.version,
      lifecycle_state:x.lifecycle_state,
      implementation_hash:x.implementation_hash,
      activation_commit_sha:x.active_event?.commit_sha??null,
    })),
    atomic_publication:true,
  },
};

const {data:runId,error:publishError}=await sb.rpc(
  "publish_universe_screen_package_v1_1",
  {p_run:runPayload,p_results:resultRows}
);
if(publishError)throw publishError;

const {count:publishedResultCount,error:countError}=await sb
  .from("universe_screen_results")
  .select("id",{count:"exact",head:true})
  .eq("universe_screen_run_id",runId);
if(countError)throw countError;
if(publishedResultCount!==resultRows.length){
  throw new Error(
    "Post-publication verification failed: expected "+resultRows.length+
    " results, found "+publishedResultCount+"."
  );
}

console.log(JSON.stringify({
  ...preview,
  materialized:true,
  atomic_publication:true,
  universe_screen_run_id:runId,
  published_result_count:publishedResultCount,
},null,2));
