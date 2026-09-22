import { canonicalSha256 } from "./integrity-hash.mjs";
import {
  valuationPreflight,
  valuationProfileForScreen,
} from "./research-candidate-pipeline.mjs";

export const RESEARCH_FACTORY_VERSION="research-factory-v1";

const n=(value)=>{
  if(value===null||value===undefined||value==="")return null;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:null;
};

const round=(value,digits=4)=>{
  const x=n(value);
  return x==null?null:Math.round(x*10**digits)/10**digits;
};

const quantile=(values,q)=>{
  const xs=(values??[]).map(n).filter(v=>v!=null&&v>0).sort((a,b)=>a-b);
  if(!xs.length)return null;
  if(xs.length===1)return xs[0];
  const pos=(xs.length-1)*q;
  const lo=Math.floor(pos),hi=Math.ceil(pos);
  if(lo===hi)return xs[lo];
  return xs[lo]+(xs[hi]-xs[lo])*(pos-lo);
};

function availableMetric(payload,key){
  const rows=Array.isArray(payload?.metric_observations)?payload.metric_observations:[];
  const row=rows.find(x=>
    x?.metric_key===key&&
    x?.status==="available"&&
    n(x?.value_numeric)!=null
  );
  return row?{
    value:n(row.value_numeric),
    period_end:row.period_end??null,
    source_title:row.source_title??null,
    source_url:row.source_url??null,
    calculation_method:row.calculation_method??null,
  }:null;
}

export function parseSecTickerExchange(body={}){
  const fields=Array.isArray(body?.fields)?body.fields:[];
  const rows=Array.isArray(body?.data)?body.data:[];
  const index=new Map(fields.map((field,i)=>[String(field),i]));
  return rows.map(row=>({
    cik:String(row?.[index.get("cik")]??"").replace(/\D/g,"").padStart(10,"0"),
    company_name:String(row?.[index.get("name")]??"").trim(),
    ticker:String(row?.[index.get("ticker")]??"").trim().toUpperCase(),
    exchange:String(row?.[index.get("exchange")]??"").trim()||null,
  })).filter(row=>row.ticker&&row.cik!=="0000000000");
}

const normalizeName=value=>String(value??"")
  .toUpperCase()
  .replace(/\b(INCORPORATED|INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LTD|PLC|HOLDINGS?)\b/g," ")
  .replace(/[^A-Z0-9]+/g," ")
  .replace(/\s+/g," ")
  .trim();

export function parseSecDerivedCatalog(body={}){
  if(![1,2].includes(Number(body?.schema_version))){
    throw new Error("Unsupported SEC-derived catalog schema.");
  }
  const companies=Array.isArray(body?.companies)?body.companies:[];
  if(companies.length<500){
    throw new Error("SEC-derived catalog is unexpectedly small.");
  }
  return companies.map(row=>({
    cik:String(row?.cik??"").replace(/\D/g,"").padStart(10,"0"),
    company_name:String(row?.name??"").trim(),
    ticker:String(row?.symbol??"").trim().toUpperCase().replaceAll("-","."),
    exchange:String(row?.exchange??"").trim()||null,
  })).filter(row=>
    row.ticker&&row.company_name&&/^\d{10}$/.test(row.cik)&&row.cik!=="0000000000"
  );
}

export function issuerNamesCompatible(left,right){
  const a=normalizeName(left);
  const b=normalizeName(right);
  if(!a||!b)return false;
  if(a===b)return true;
  const aa=new Set(a.split(" ").filter(Boolean));
  const bb=new Set(b.split(" ").filter(Boolean));
  const overlap=[...aa].filter(token=>bb.has(token)).length;
  return overlap/Math.max(aa.size,bb.size,1)>=0.6;
}

export function resolveSecIdentity({ticker,companyName},secRows=[]){
  const symbol=String(ticker??"").trim().toUpperCase();
  const matches=secRows.filter(row=>row.ticker===symbol);
  if(matches.length===1)return{status:"matched",match:matches[0],candidates:1};
  if(!matches.length)return{status:"missing",match:null,candidates:0};

  const target=normalizeName(companyName);
  const exact=matches.filter(row=>normalizeName(row.company_name)===target);
  if(exact.length===1)return{status:"matched",match:exact[0],candidates:matches.length};

  const scored=matches.map(row=>{
    const a=new Set(target.split(" ").filter(Boolean));
    const b=new Set(normalizeName(row.company_name).split(" ").filter(Boolean));
    const overlap=[...a].filter(token=>b.has(token)).length;
    const denom=Math.max(a.size,b.size,1);
    return{row,score:overlap/denom};
  }).sort((a,b)=>b.score-a.score);

  if(scored[0]&&scored[0].score>=0.6&&
     (!scored[1]||scored[0].score-scored[1].score>=0.2)){
    return{status:"matched",match:scored[0].row,candidates:matches.length};
  }
  return{
    status:"ambiguous",
    match:null,
    candidates:matches.length,
    options:matches,
  };
}

export function buildResearchFactoryRunHash({pipelineRun,items=[]}={}){
  if(!pipelineRun?.id)throw new Error("Research Factory requires a source candidate-pipeline run.");
  return canonicalSha256({
    contract:"solpient-research-factory-run-v1",
    factory_version:RESEARCH_FACTORY_VERSION,
    source_pipeline_run_id:pipelineRun.id,
    source_pipeline_input_hash:pipelineRun.input_hash??null,
    source_pipeline_version:pipelineRun.pipeline_version??null,
    evaluation_as_of:pipelineRun.evaluation_as_of??null,
    candidates:[...items].map(item=>({
      id:item.id,
      ticker:String(item.ticker??"").toUpperCase(),
      item_hash:item.item_hash??null,
    })).sort((a,b)=>a.ticker.localeCompare(b.ticker)),
  });
}

function scenarioAnchors(values,minCount){
  const xs=(values??[]).map(n).filter(v=>v!=null&&v>0);
  if(xs.length<minCount)return null;
  return{
    bear:round(quantile(xs,0.25),2),
    base:round(quantile(xs,0.50),2),
    bull:round(quantile(xs,0.75),2),
  };
}

export function buildEvidenceValuationDraft({
  screenResult={},
  company=null,
  baselineDraft=null,
  valuationHistory=[],
  contextPack=null,
  generatedAt=new Date().toISOString(),
}={}){
  const profile=valuationProfileForScreen({
    profile:screenResult.screen_profile??screenResult.profile??"general",
  });
  const fcf=availableMetric(baselineDraft?.draft_payload,"fcf_per_share");
  const historicalPfcf=(valuationHistory??[]).map(row=>row.price_to_fcf);
  const peerPfcf=(contextPack?.peer_comparison??[])
    .filter(row=>row?.data_status==="available")
    .map(row=>row?.metrics?.price_to_fcf);

  const valuationInput={
    industryModule:profile,
    currentPrice:n(screenResult?.input_summary?.price),
  };
  if(fcf?.value!=null)valuationInput.fcfPerShare=round(fcf.value,6);

  const historical=scenarioAnchors(historicalPfcf,12);
  const peer=scenarioAnchors(peerPfcf,2);
  if(historical||peer){
    valuationInput.multiples={};
    if(historical)valuationInput.multiples.historical=historical;
    if(peer)valuationInput.multiples.peer=peer;
  }

  // Deliberately leave subjective forward assumptions unresolved.
  valuationInput.assumptions={};

  const preflight=valuationPreflight({
    ticker:screenResult.ticker,
    profile:screenResult.screen_profile??screenResult.profile??"general",
  },valuationInput);

  const evidence={
    generated_at:generatedAt,
    company_id:company?.id??null,
    screen_result_id:screenResult?.id??null,
    screen_result_hash:screenResult?.result_hash??null,
    screen_price:{
      value:n(screenResult?.input_summary?.price),
      as_of:"immutable universe screen input",
    },
    fcf_per_share:fcf,
    historical_price_to_fcf_observations:historicalPfcf.filter(v=>n(v)!=null).length,
    peer_price_to_fcf_observations:peerPfcf.filter(v=>n(v)!=null).length,
    baseline_draft_id:baselineDraft?.id??null,
    context_pack_id:contextPack?.id??null,
    safeguards:[
      "No growth, discount-rate, terminal-growth, normalized-EPS, book-value, or return assumptions are invented.",
      "Historical and peer multiple anchors are derived only from stored observations.",
      "This draft cannot become a reviewed Valuation V3 input pack without explicit analyst review.",
    ],
  };

  const inputHash=canonicalSha256({
    contract:"solpient-research-factory-valuation-draft-v1",
    ticker:String(screenResult.ticker??"").toUpperCase(),
    valuation_input:valuationInput,
    evidence,
  });

  return{
    factory_version:RESEARCH_FACTORY_VERSION,
    ticker:String(screenResult.ticker??"").toUpperCase(),
    industry_module:profile,
    valuation_input:valuationInput,
    preflight,
    missing_fields:preflight.missing??[],
    evidence,
    input_hash:inputHash,
  };
}

export function deriveResearchFactoryState({
  company=null,
  coverage=null,
  baselineDraft=null,
  composition=null,
  valuationDraft=null,
  reviewedValuationPack=null,
  publishedResearch=null,
  sourcePipelineItem=null,
  repairJobs=[],
  industryModuleKnown=null,
}={}){
  const activeRepairs=(repairJobs??[]).filter(job=>job.status!=="completed");
  const automatedRepairs=activeRepairs.filter(job=>["pending","running","verifying","monitoring"].includes(job.status));
  const manualRepairs=activeRepairs.filter(job=>["needs_review","blocked"].includes(job.status));
  const coveragePct=n(coverage?.decision_readiness_pct)??n(coverage?.overall_pct);

  let stage,status,nextAction;
  if(!company){
    stage="onboarding";status="queued";
    nextAction="Resolve canonical SEC identity and create the Solpient company record.";
  }else if(!coverage){
    stage="evidence_ingestion";status="queued";
    nextAction="Ingest primary-source fundamentals, market history, and historical context.";
  }else if(!baselineDraft){
    stage="baseline_draft";status="queued";
    nextAction="Build the private evidence-grounded baseline draft.";
  }else if(!composition){
    stage="research_draft";status="queued";
    nextAction="Compose the private Research Standard v2 draft.";
  }else if(!reviewedValuationPack){
    stage="valuation_review";status="needs_review";
    nextAction=valuationDraft
      ?"Review the evidence-prefilled Valuation V3 draft and supply explicit forward assumptions."
      :"Generate the evidence-prefilled Valuation V3 draft.";
  }else if(!publishedResearch){
    stage="research_review";status="needs_review";
    nextAction="Review the research composition and publish only after Research Standard gates pass.";
  }else if(["decision_ready","research_ready"].includes(sourcePipelineItem?.stage)){
    stage="complete";status="complete";
    nextAction="No factory action required for this source snapshot.";
  }else{
    stage="pipeline_refresh";status="queued";
    nextAction="Materialize a new immutable Pipeline V2.4 snapshot using the reviewed research and valuation inputs.";
  }

  const factoryReviewActions=[];
  if(industryModuleKnown===false){
    factoryReviewActions.push({
      priority:99,
      type:"industry_module_review",
      action:"Assign and review the company-specific industry module before decision-grade research.",
      reason:"This ticker does not yet have a reviewed Research Factory industry-module assignment; generic coverage must not substitute for sector-specific evidence.",
    });
    if(["valuation_review","research_review","pipeline_refresh","complete"].includes(stage)){
      status="needs_review";
      if(stage==="complete")stage="pipeline_refresh";
    }
  }

  if(status==="queued"&&(manualRepairs.length||factoryReviewActions.length)){
    status="needs_review";
  }

  return{
    stage,
    status,
    coverage_pct:coveragePct,
    repair_job_count:activeRepairs.length,
    manual_review_count:manualRepairs.length,
    automated_repair_count:automatedRepairs.length,
    next_actions:[
      {
        priority:100,
        type:stage,
        action:nextAction,
      },
      ...factoryReviewActions,
      ...manualRepairs.slice(0,6).map(job=>({
        priority:Number(job.priority??80),
        type:"repair_review",
        action:job.reason??("Review "+job.layer+" / "+job.field),
        repair_job_id:job.id,
      })),
    ],
  };
}

export function buildFactoryStateHash(payload={}){
  return canonicalSha256({
    contract:"solpient-research-factory-state-v1",
    ...payload,
  });
}
