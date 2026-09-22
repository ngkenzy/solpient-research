import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function clamp(v){return Math.max(0,Math.min(100,Math.round(v)));}

const REPAIRS={
  fundamentals:{repair_type:"fundamentals_refresh",automation_mode:"auto",runner:"fundamentals",weight:28},
  balance_sheet:{repair_type:"fundamentals_refresh",automation_mode:"auto",runner:"fundamentals",weight:28},
  history:{repair_type:"fundamentals_refresh",automation_mode:"auto",runner:"fundamentals",weight:24},
  market_history:{repair_type:"market_history_refresh",automation_mode:"auto",runner:"market_context",weight:24},
  valuation_history:{repair_type:"valuation_history_refresh",automation_mode:"auto",runner:"market_context",weight:30},
  peers:{repair_type:"peer_context_refresh",automation_mode:"auto",runner:"peer_context",weight:25},
  consensus:{repair_type:"consensus_accumulation",automation_mode:"scheduled",runner:"consensus",weight:12},
  capital_allocation:{repair_type:"capital_allocation_backfill",automation_mode:"auto",runner:"capital_history",weight:32},
  industry:{repair_type:"autonomous_industry_assignment",automation_mode:"auto",runner:"autonomous_industry",weight:26},
  research:{repair_type:"research_review",automation_mode:"manual",runner:null,weight:35},
  valuation_bridge:{repair_type:"autonomous_valuation_policy",automation_mode:"auto",runner:"autonomous_valuation",weight:30},
};

function reasonFor(gap){
  const layer=String(gap?.layer??"research");
  const field=String(gap?.field??"coverage_gap").replaceAll("_"," ");
  if(layer==="consensus")return "Point-in-time consensus history must accumulate over multiple dates; the scheduled consensus collector is already running.";
  if(layer==="capital_allocation")return "Autonomous repair rebuilds complete annual capital-allocation history from stored normalized cash-flow evidence.";
  if(layer==="industry")return "Autonomous Research Factory V2.1 assigns a sector-specific module when the immutable screening classification clears the confidence policy; otherwise the ticker is quarantined.";
  if(layer==="research")return "Research publication is not part of V2.1; this gap remains for the autonomous research-verification layer.";
  if(layer==="valuation_bridge")return "Autonomous Research Factory V2.1 can persist a policy-derived Valuation V3 input pack when evidence and preflight thresholds are satisfied.";
  return "Coverage v2 detected an incomplete "+layer.replaceAll("_"," ")+" layer: "+field+".";
}

const [companiesR,coverageR,jobsR]=await Promise.all([
  sb.from("companies").select("id,ticker,company_name").order("ticker"),
  sb.from("data_coverage_reports").select("*").eq("engine_version","coverage-v2").order("as_of_date",{ascending:false}).order("generated_at",{ascending:false}),
  sb.from("research_repair_jobs").select("*")
]);
for(const r of [companiesR,coverageR,jobsR])if(r.error)throw r.error;

const companyById=new Map((companiesR.data??[]).map(c=>[c.id,c]));
const latestCoverage=new Map();
for(const row of coverageR.data??[])if(!latestCoverage.has(row.company_id))latestCoverage.set(row.company_id,row);
const existingByKey=new Map((jobsR.data??[]).map(j=>[[j.company_id,j.layer,j.field].join("|"),j]));
const activeKeys=new Set();
const now=new Date().toISOString();
const upserts=[];

for(const [companyId,report] of latestCoverage){
  const company=companyById.get(companyId);
  if(!company)continue;
  const readiness=n(report.decision_readiness_pct)??n(report.overall_pct)??0;
  const gaps=Array.isArray(report.missing_fields)?report.missing_fields:[];
  for(const gap of gaps){
    const layer=String(gap?.layer??"research");
    const field=String(gap?.field??"coverage_gap");
    const repair=REPAIRS[layer]??{repair_type:"manual_research_review",automation_mode:"manual",runner:null,weight:20};
    const key=[companyId,layer,field].join("|");
    activeKeys.add(key);
    const existing=existingByKey.get(key);
    let status=repair.automation_mode==="manual"?"needs_review":repair.automation_mode==="scheduled"?"monitoring":"pending";
    if(existing?.status==="running")status="running";
    if(repair.automation_mode==="auto"&&Number(existing?.attempt_count??0)>=3)status="blocked";
    const priority=clamp((100-readiness)*0.7+repair.weight);
    upserts.push({
      company_id:companyId,layer,field,repair_type:repair.repair_type,
      automation_mode:repair.automation_mode,runner:repair.runner,status,priority,
      readiness_pct:readiness,coverage_date:report.as_of_date,
      reason:reasonFor(gap),
      details:{
        ticker:company.ticker,
        company_name:company.company_name,
        coverage_gap:gap,
        coverage_engine:report.engine_version,
        overall_pct:n(report.overall_pct),
        next_action:repair.repair_type,
      },
      attempt_count:Number(existing?.attempt_count??0),
      last_attempt_at:existing?.last_attempt_at??null,
      last_error:status==="blocked"?(existing?.last_error??"Automatic repair did not resolve the coverage gap after three attempts."):existing?.last_error??null,
      completed_at:null,
      updated_at:now,
    });
  }
}

for(let i=0;i<upserts.length;i+=100){
  const {error}=await sb.from("research_repair_jobs").upsert(upserts.slice(i,i+100),{onConflict:"company_id,layer,field"});
  if(error)throw error;
}

const unresolved=(jobsR.data??[]).filter(j=>!["completed"].includes(j.status));
for(const job of unresolved){
  const key=[job.company_id,job.layer,job.field].join("|");
  if(activeKeys.has(key))continue;
  const {error}=await sb.from("research_repair_jobs").update({
    status:"completed",completed_at:now,last_error:null,updated_at:now,
    details:{...(job.details??{}),resolution:"Resolved by the latest coverage-v2 report."}
  }).eq("id",job.id);
  if(error)throw error;
}

const {data:final,error:finalError}=await sb
  .from("research_repair_jobs")
  .select("status,automation_mode,priority,company_id,layer,field,repair_type")
  .order("priority",{ascending:false});
if(finalError)throw finalError;
const counts={};
for(const row of final??[])counts[row.status]=(counts[row.status]??0)+1;
console.log(JSON.stringify({
  generated_at:now,
  companies:latestCoverage.size,
  active_gaps:activeKeys.size,
  counts,
  top:(final??[]).filter(j=>j.status!=="completed").slice(0,15)
},null,2));
