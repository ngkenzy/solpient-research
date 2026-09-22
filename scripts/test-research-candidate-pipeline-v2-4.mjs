import assert from "node:assert/strict";
import {
  RESEARCH_CANDIDATE_PIPELINE_VERSION,
  RESEARCH_CANDIDATE_PIPELINE_PREDECESSOR_VERSION,
  buildResearchCandidatePipeline,
} from "../lib/research-candidate-pipeline-v2-4.mjs";
import {
  RESEARCH_CANDIDATE_MATERIALIZATION_PROTOCOL_VERSION,
  buildCandidateSourceSnapshot,
  buildCandidatePipelineInputHash,
  buildCandidateItemHash,
  chunkCandidateItems,
  publishResearchCandidatePipelineStaged,
} from "../lib/research-candidate-materialization-v1.mjs";

assert.equal(RESEARCH_CANDIDATE_PIPELINE_VERSION,"research-candidate-pipeline-v2.4");
assert.equal(RESEARCH_CANDIDATE_PIPELINE_PREDECESSOR_VERSION,"research-candidate-pipeline-v2.3");
assert.equal(
  RESEARCH_CANDIDATE_MATERIALIZATION_PROTOCOL_VERSION,
  "research-candidate-materialization-v1.1"
);

assert.throws(
  ()=>buildResearchCandidatePipeline({
    screenResult:{
      ticker:"TEST",
      profile:"software",
      state:"solpient_100_candidate",
      proposedForDeepResearch:true,
    },
  }),
  /explicit evaluationAsOf/
);

const screenResult={
  ticker:"TEST",
  company_name:"Test Software",
  profile:"software",
  state:"solpient_100_candidate",
  screenScore:88,
  qualityCoreScore:90,
  rawEvidenceCoveragePct:90,
  evidenceCoveragePct:90,
  proposedForDeepResearch:true,
  methodologyVersion:"solpient-universe-screen-v2.3",
};

const valuationInput={
  currentPrice:100,
  fcfPerShare:6,
  assumptions:{
    bear:{initialGrowth:3,matureGrowth:1,discountRate:12,terminalGrowth:2},
    base:{initialGrowth:8,matureGrowth:4,discountRate:10,terminalGrowth:2.5},
    bull:{initialGrowth:12,matureGrowth:6,discountRate:9,terminalGrowth:3},
  },
  multiples:{
    historical:{bear:16,base:20,bull:24},
    peer:{bear:17,base:21,bull:25},
  },
  evidence:{valuationHistoryYears:5,peerCount:4,primarySourcePct:100},
  returnScenarios:{
    bear:{startingMetricPerShare:6,metricGrowthRate:2,exitMultiple:16},
    base:{startingMetricPerShare:6,metricGrowthRate:8,exitMultiple:20},
    bull:{startingMetricPerShare:6,metricGrowthRate:12,exitMultiple:24},
  },
};

const researchInput={
  scores:{
    quality_score:92,
    moat_score:88,
    financial_strength_score:90,
  },
  coverage:{
    engine_version:"coverage-v2",
    as_of_date:"2026-09-21",
    fundamentals_pct:100,
    balance_sheet_pct:100,
    history_pct:100,
    market_history_pct:100,
    valuation_history_pct:100,
    capital_allocation_pct:100,
    peer_pct:100,
    industry_pct:100,
    consensus_pct:100,
    research_structure_pct:100,
    primary_source_quarters:5,
    normalized_quarters:5,
  },
  researchedAt:"2026-09-20T12:00:00Z",
};

const a=buildResearchCandidatePipeline({
  evaluationAsOf:"2026-09-21T23:59:59Z",
  screenResult,
  companyExists:true,
  valuationInput,
  researchInput,
});
const b=buildResearchCandidatePipeline({
  evaluationAsOf:"2026-09-21T23:59:59Z",
  screenResult,
  companyExists:true,
  valuationInput,
  researchInput,
});
assert.deepEqual(a,b);
assert.equal(a.pipelineVersion,"research-candidate-pipeline-v2.4");
assert.equal(a.evaluationAsOf,"2026-09-21T23:59:59.000Z");

const source=buildCandidateSourceSnapshot({
  screenResult:{
    id:"00000000-0000-0000-0000-000000000001",
    ticker:"TEST",
    result_hash:"a".repeat(64),
    screen_state:"solpient_100_candidate",
    shortlist_rank:1,
    proposed_for_deep_research:true,
  },
  company:{id:"00000000-0000-0000-0000-000000000002",ticker:"TEST",company_name:"Test"},
  researchRun:{id:"00000000-0000-0000-0000-000000000003",researched_at:"2026-09-20T12:00:00Z",status:"published"},
  coverage:researchInput.coverage,
  scoreRow:{id:"score-1",quality_score:92,moat_score:88,financial_strength_score:90},
  valuationPack:{id:"pack-1",input_hash:"b".repeat(64),status:"reviewed"},
  valuationInput,
  researchInput,
  evaluationAsOf:"2026-09-21T23:59:59.000Z",
});
assert.match(source.source_snapshot_hash,/^[0-9a-f]{64}$/);

const hash1=buildCandidatePipelineInputHash({
  pipelineVersion:RESEARCH_CANDIDATE_PIPELINE_VERSION,
  valuationMethodologyVersion:"solpient-valuation-methodology-v3",
  readinessMethodologyVersion:"readiness-v1",
  universeScreenRunId:"00000000-0000-0000-0000-000000000010",
  universeScreenInputHash:"c".repeat(64),
  screenValidationHash:"d".repeat(64),
  universeInputHash:"e".repeat(64),
  evaluationAsOf:"2026-09-21T23:59:59.000Z",
  activeImplementationHash:"f".repeat(64),
  sources:[{ticker:"TEST",source_snapshot_hash:source.source_snapshot_hash}],
});
const hash2=buildCandidatePipelineInputHash({
  pipelineVersion:RESEARCH_CANDIDATE_PIPELINE_VERSION,
  valuationMethodologyVersion:"solpient-valuation-methodology-v3",
  readinessMethodologyVersion:"readiness-v1",
  universeScreenRunId:"00000000-0000-0000-0000-000000000010",
  universeScreenInputHash:"c".repeat(64),
  screenValidationHash:"d".repeat(64),
  universeInputHash:"e".repeat(64),
  evaluationAsOf:"2026-09-22T23:59:59.000Z",
  activeImplementationHash:"f".repeat(64),
  sources:[{ticker:"TEST",source_snapshot_hash:source.source_snapshot_hash}],
});
assert.notEqual(hash1,hash2,"evaluation time must be part of the pipeline input hash");

const semanticPayload={
  ticker:"TEST",
  stage:a.stage,
  source_snapshot_hash:source.source_snapshot_hash,
  pipeline_output:a,
};
assert.equal(
  buildCandidateItemHash(semanticPayload),
  buildCandidateItemHash({...semanticPayload})
);

const rows=Array.from({length:7},(_,i)=>({
  ticker:"T"+(i+1),
  item_hash:String(i+1).repeat(64).slice(0,64),
  source_snapshot_hash:String(9-i).repeat(64).slice(0,64),
  pipeline_output:{pipelineVersion:"research-candidate-pipeline-v2.4"},
  padding:"x".repeat(40),
}));
const chunks=chunkCandidateItems(rows,{maxRows:3,maxBytes:10_000});
assert.deepEqual(chunks.map(x=>x.startOrdinal),[1,4,7]);
assert.deepEqual(chunks.map(x=>x.rows.length),[3,3,1]);

let stageAttempts=0;
const calls=[];
const fakeSb={
  async rpc(name,args){
    calls.push({name,args});
    if(name==="begin_research_candidate_pipeline_publish_v2_4"){
      return{
        data:{
          status:"staging",
          publish_session_id:"00000000-0000-0000-0000-000000000020",
          run_id:null,
        },
        error:null,
      };
    }
    if(name==="stage_research_candidate_pipeline_items_v2_4"){
      stageAttempts++;
      if(stageAttempts===1)return{data:null,error:{message:"Cloudflare 520"}};
      return{data:{ok:true},error:null};
    }
    if(name==="finalize_research_candidate_pipeline_publish_v2_4"){
      return{data:"00000000-0000-0000-0000-000000000099",error:null};
    }
    throw new Error("Unexpected RPC "+name);
  },
};
const published=await publishResearchCandidatePipelineStaged({
  sb:fakeSb,
  runPayload:{input_hash:"a".repeat(64)},
  items:rows,
  maxRows:3,
  maxBytes:10_000,
  maxAttempts:3,
  sleep:async()=>{},
});
assert.equal(published.runId,"00000000-0000-0000-0000-000000000099");
assert.equal(published.stagedChunkCount,3);
assert.equal(
  calls.filter(x=>x.name==="stage_research_candidate_pipeline_items_v2_4").length,
  4
);

console.log("Research Candidate Pipeline V2.4 integrity tests passed.");
