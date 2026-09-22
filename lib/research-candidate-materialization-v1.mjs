import { canonicalSha256, CANONICALIZATION_VERSION } from "./integrity-hash.mjs";

export const RESEARCH_CANDIDATE_MATERIALIZATION_PROTOCOL_VERSION=
  "research-candidate-materialization-v1.1";

const stable=(value)=>JSON.parse(JSON.stringify(value??null));

export function buildCandidateSourceSnapshot({
  screenResult,
  company,
  researchRun,
  coverage,
  scoreRow,
  valuationPack,
  valuationInput,
  researchInput,
  evaluationAsOf,
}={}){
  const snapshot={
    canonicalization_version:CANONICALIZATION_VERSION,
    evaluation_as_of:evaluationAsOf??null,
    screen:{
      id:screenResult?.id??null,
      ticker:screenResult?.ticker??null,
      result_hash:screenResult?.result_hash??null,
      screen_state:screenResult?.screen_state??null,
      shortlist_rank:screenResult?.shortlist_rank??null,
      proposed_for_deep_research:Boolean(screenResult?.proposed_for_deep_research),
    },
    company:company?{
      id:company.id??null,
      ticker:company.ticker??null,
      company_name:company.company_name??null,
    }:null,
    valuation_pack:valuationPack?{
      id:valuationPack.id??null,
      input_hash:valuationPack.input_hash??null,
      status:valuationPack.status??null,
      reviewed_at:valuationPack.reviewed_at??null,
      reviewed_by:valuationPack.reviewed_by??null,
      industry_module:valuationPack.industry_module??null,
    }:null,
    research_run:researchRun?{
      id:researchRun.id??null,
      company_id:researchRun.company_id??null,
      researched_at:researchRun.researched_at??null,
      status:researchRun.status??null,
      price_at_research:researchRun.price_at_research??null,
    }:null,
    score_snapshot:scoreRow?stable(scoreRow):null,
    coverage_snapshot:coverage?stable(coverage):null,
    valuation_input:stable(valuationInput??{}),
    research_input:stable(researchInput??{}),
  };
  return{
    snapshot,
    source_snapshot_hash:canonicalSha256(snapshot),
  };
}

export function buildCandidatePipelineInputHash({
  pipelineVersion,
  valuationMethodologyVersion,
  readinessMethodologyVersion,
  universeScreenRunId,
  universeScreenInputHash,
  screenValidationHash,
  universeInputHash,
  evaluationAsOf,
  activeImplementationHash,
  sources=[],
}={}){
  return canonicalSha256({
    contract:"solpient-research-candidate-pipeline-input-v2.4",
    canonicalization_version:CANONICALIZATION_VERSION,
    materialization_protocol_version:RESEARCH_CANDIDATE_MATERIALIZATION_PROTOCOL_VERSION,
    pipeline_version:pipelineVersion,
    valuation_methodology_version:valuationMethodologyVersion,
    readiness_methodology_version:readinessMethodologyVersion,
    universe_screen_run_id:universeScreenRunId,
    universe_screen_input_hash:universeScreenInputHash,
    screen_validation_hash:screenValidationHash,
    universe_input_hash:universeInputHash,
    evaluation_as_of:evaluationAsOf,
    active_implementation_hash:activeImplementationHash,
    sources:[...sources].sort((a,b)=>
      String(a.ticker??"").localeCompare(String(b.ticker??""))
    ),
  });
}

export function buildCandidateItemHash(payload={}){
  return canonicalSha256({
    contract:"solpient-research-candidate-pipeline-item-v2.4",
    payload,
  });
}

export function chunkCandidateItems(rows=[],options={}){
  const maxRows=Math.max(1,Number(options.maxRows??20)||20);
  const maxBytes=Math.max(1024,Number(options.maxBytes??180_000)||180_000);
  const chunks=[];
  let current=[];
  let bytes=2;
  let startOrdinal=1;

  for(const row of rows){
    const rowBytes=Buffer.byteLength(JSON.stringify(row),"utf8")+1;
    if(rowBytes>maxBytes){
      throw new Error(
        "A single research-candidate item exceeds the staging payload ceiling for "+
        String(row?.ticker??"unknown")+": "+rowBytes+" bytes."
      );
    }
    if(current.length&&(current.length>=maxRows||bytes+rowBytes>maxBytes)){
      chunks.push({startOrdinal,rows:current,bytes});
      startOrdinal+=current.length;
      current=[];
      bytes=2;
    }
    current.push(row);
    bytes+=rowBytes;
  }
  if(current.length)chunks.push({startOrdinal,rows:current,bytes});
  return chunks;
}

export function isTransientTransportError(error){
  const message=String(error?.message??error??"");
  return /\b520\b|\b502\b|\b503\b|\b504\b|cloudflare|fetch failed|network/i.test(message);
}

const defaultSleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

export async function rpcWithTransientRetry(sb,name,args,options={}){
  const maxAttempts=Math.max(1,Number(options.maxAttempts??4)||4);
  const sleep=options.sleep??defaultSleep;
  let lastError=null;
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    const {data,error}=await sb.rpc(name,args);
    if(!error)return data;
    lastError=error;
    if(!isTransientTransportError(error)||attempt===maxAttempts)throw error;
    await sleep(Math.min(500*2**(attempt-1),4000));
  }
  throw lastError??new Error("RPC failed: "+name);
}

export async function publishResearchCandidatePipelineStaged({
  sb,
  runPayload,
  items,
  maxRows=20,
  maxBytes=180_000,
  maxAttempts=4,
  sleep,
}={}){
  if(!sb?.rpc)throw new Error("Supabase client with rpc() is required.");
  if(!runPayload||typeof runPayload!=="object")throw new Error("runPayload is required.");
  if(!Array.isArray(items))throw new Error("items must be an array.");

  const begin=await rpcWithTransientRetry(
    sb,
    "begin_research_candidate_pipeline_publish_v2_4",
    {p_run:runPayload},
    {maxAttempts,sleep}
  );

  let runId=begin?.run_id??null;
  const publishSessionId=begin?.publish_session_id??null;
  let stagedChunkCount=0;

  if(!runId){
    if(!publishSessionId){
      throw new Error("Candidate pipeline publication did not return a publish session id.");
    }
    for(const chunk of chunkCandidateItems(items,{maxRows,maxBytes})){
      await rpcWithTransientRetry(
        sb,
        "stage_research_candidate_pipeline_items_v2_4",
        {
          p_publish_session_id:publishSessionId,
          p_start_ordinal:chunk.startOrdinal,
          p_items:chunk.rows,
        },
        {maxAttempts,sleep}
      );
      stagedChunkCount++;
    }
    runId=await rpcWithTransientRetry(
      sb,
      "finalize_research_candidate_pipeline_publish_v2_4",
      {p_publish_session_id:publishSessionId},
      {maxAttempts,sleep}
    );
  }

  if(!runId)throw new Error("Candidate pipeline publication did not return a run id.");

  return{
    runId,
    publishSessionId,
    stagedChunkCount,
    alreadyPublished:Boolean(begin?.run_id),
  };
}
