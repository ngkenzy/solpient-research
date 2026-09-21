import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { canonicalSha256, CANONICALIZATION_VERSION } from "../lib/integrity-hash.mjs";
import {
  TRACK_RECORD_METHODOLOGY_VERSION,
  CALIBRATION_BUCKET_VERSION,
  buildTrackRecordScopes,
  minimumHistoryMessage,
} from "../lib/track-record-calibration.mjs";

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");

const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const asOfAt=new Date().toISOString();

function n(v){
  if(v===null||v===undefined||v==="")return null;
  const x=Number(v);
  return Number.isFinite(x)?x:null;
}

function directionCorrect(outcome,actual){
  const y=n(actual?.actual_value);
  const p=n(outcome.predicted_probability);
  if(p!=null&&y!=null&&[0,1].includes(y)){
    return (p>=50&&y===1)||(p<50&&y===0);
  }

  if(["price_return_pct","relative_return_pct","benchmark_excess_return"].includes(outcome.metric_key)){
    const predicted=n(outcome.predicted_value);
    if(predicted!=null&&y!=null)return Math.sign(predicted)===Math.sign(y);
  }

  const text=String(outcome.predicted_text??"").toLowerCase();
  if(y!=null&&text.includes("outperform"))return y>0;
  if(y!=null&&text.includes("underperform"))return y<0;
  return null;
}

function authoritativeRealized(rows=[]){
  const superseded=new Set(rows.filter(r=>r.supersedes_id).map(r=>r.supersedes_id));
  const leaves=rows.filter(r=>!superseded.has(r.id));
  const byOutcome=new Map();
  for(const row of leaves){
    const existing=byOutcome.get(row.prediction_outcome_id);
    if(!existing){
      byOutcome.set(row.prediction_outcome_id,row);
      continue;
    }
    const a=String(row.corrected_at??row.created_at??row.observed_at??"");
    const b=String(existing.corrected_at??existing.created_at??existing.observed_at??"");
    if(a>b)byOutcome.set(row.prediction_outcome_id,row);
  }
  return byOutcome;
}

async function startRun(){
  const {data,error}=await sb.from("automation_runs").insert({
    pipeline:"verified_track_record",
    status:"running",
    details:{methodology_version:TRACK_RECORD_METHODOLOGY_VERSION},
  }).select("id").single();
  if(error)throw error;
  return data.id;
}
async function finishRun(id,status,records,message,details={}){
  const {error}=await sb.from("automation_runs").update({
    status,records_written:records,message,details,completed_at:new Date().toISOString(),
  }).eq("id",id);
  if(error)throw error;
}

const automationRunId=await startRun();
let records=0;

try{
  const [snapshotsR,outcomesR,realizedR,companiesR]=await Promise.all([
    sb.from("prediction_snapshots")
      .select("id,company_id,prediction_key,predicted_at,model_version,horizon_months,benchmark_ticker,confidence,locked_at,integrity_version,integrity_hash,supersedes_id"),
    sb.from("prediction_outcomes")
      .select("id,prediction_snapshot_id,metric_key,label,outcome_type,predicted_value,predicted_low,predicted_high,predicted_probability,predicted_text,unit,target_date,resolver_status,resolved_at"),
    sb.from("realized_outcomes")
      .select("id,prediction_outcome_id,observed_at,actual_value,actual_text,source_url,source_note,created_at,supersedes_id,correction_reason,corrected_at,integrity_version,integrity_hash"),
    sb.from("companies").select("id,ticker,company_name"),
  ]);
  for(const r of [snapshotsR,outcomesR,realizedR,companiesR])if(r.error)throw r.error;

  const snapshotById=new Map((snapshotsR.data??[]).map(r=>[r.id,r]));
  const companyById=new Map((companiesR.data??[]).map(r=>[r.id,r]));
  const realizedByOutcome=authoritativeRealized(realizedR.data??[]);
  const inputRows=[];

  for(const outcome of outcomesR.data??[]){
    const snapshot=snapshotById.get(outcome.prediction_snapshot_id);
    if(!snapshot)continue;
    const actual=realizedByOutcome.get(outcome.id)??null;
    const company=companyById.get(snapshot.company_id);
    const actualValue=n(actual?.actual_value);
    const benchmarkExcess=outcome.metric_key==="relative_return_pct" ? actualValue : null;
    inputRows.push({
      prediction_snapshot_id:snapshot.id,
      prediction_outcome_id:outcome.id,
      company_id:snapshot.company_id,
      ticker:company?.ticker??null,
      model_version:snapshot.model_version,
      horizon_months:snapshot.horizon_months,
      outcome_type:outcome.outcome_type,
      metric_key:outcome.metric_key,
      target_date:outcome.target_date,
      predicted_at:snapshot.predicted_at,
      locked_at:snapshot.locked_at,
      snapshot_confidence:n(snapshot.confidence),
      predicted_value:n(outcome.predicted_value),
      predicted_low:n(outcome.predicted_low),
      predicted_high:n(outcome.predicted_high),
      predicted_probability:n(outcome.predicted_probability),
      predicted_text:outcome.predicted_text,
      realized_outcome_id:actual?.id??null,
      actual_value:actualValue,
      actual_text:actual?.actual_text??null,
      observed_at:actual?.observed_at??null,
      source_url:actual?.source_url??null,
      source_note:actual?.source_note??null,
      realized_integrity_hash:actual?.integrity_hash??null,
      direction_correct:actual?directionCorrect(outcome,actual):null,
      benchmark_excess_return:benchmarkExcess,
    });
  }

  inputRows.sort((a,b)=>
    [a.prediction_snapshot_id,a.prediction_outcome_id,a.realized_outcome_id??""].join("|")
      .localeCompare([b.prediction_snapshot_id,b.prediction_outcome_id,b.realized_outcome_id??""].join("|"))
  );

  const inputHash=canonicalSha256({
    methodology_version:TRACK_RECORD_METHODOLOGY_VERSION,
    canonicalization_version:CANONICALIZATION_VERSION,
    rows:inputRows,
  });

  const {data:existing,error:existingError}=await sb.from("track_record_runs")
    .select("id,as_of_at,verified_row_count")
    .eq("input_hash",inputHash)
    .maybeSingle();
  if(existingError)throw existingError;

  if(existing){
    await finishRun(
      automationRunId,"success",0,
      "Track-record inputs unchanged; no duplicate immutable evaluation written.",
      {
        skipped:true,
        duplicate_track_record_run_id:existing.id,
        duplicate_as_of_at:existing.as_of_at,
        verified_rows:existing.verified_row_count,
        input_hash:inputHash,
      }
    );
    console.log(JSON.stringify({skipped:true,input_hash:inputHash,duplicate_run_id:existing.id},null,2));
    process.exit(0);
  }

  const scopes=buildTrackRecordScopes(inputRows);
  const global=scopes.find(s=>s.scope_type==="global"&&s.scope_key==="all");
  const sourceSummary={
    snapshots:(snapshotsR.data??[]).length,
    locked_snapshots:(snapshotsR.data??[]).filter(s=>s.locked_at).length,
    prediction_outcomes:(outcomesR.data??[]).length,
    realized_rows_total:(realizedR.data??[]).length,
    authoritative_realized_rows:realizedByOutcome.size,
    companies:(companiesR.data??[]).length,
    canonicalization_version:CANONICALIZATION_VERSION,
  };

  const {data:trackRun,error:runError}=await sb.from("track_record_runs").insert({
    as_of_at:asOfAt,
    methodology_version:TRACK_RECORD_METHODOLOGY_VERSION,
    calibration_bucket_version:CALIBRATION_BUCKET_VERSION,
    input_hash:inputHash,
    forecast_row_count:global?.total_forecast_rows??inputRows.length,
    verified_row_count:global?.verified_sample_size??0,
    unresolved_row_count:global?.unresolved_count??0,
    weak_lineage_row_count:global?.weak_lineage_count??0,
    unverified_snapshot_row_count:global?.unverified_snapshot_count??0,
    source_summary:sourceSummary,
  }).select("id").single();
  if(runError)throw runError;
  records+=1;

  const snapshotIdByKey=new Map();
  for(const scope of scopes){
    let label=scope.label;
    if(scope.scope_type==="company"){
      const company=companyById.get(scope.scope_key);
      if(company)label=company.ticker+" · "+company.company_name;
    }else if(scope.scope_type==="horizon"){
      label=scope.scope_key+" month horizon";
    }else if(scope.scope_type==="model"){
      label="Model "+scope.scope_key;
    }else if(scope.scope_type==="metric"){
      label=scope.scope_key.replaceAll("_"," ");
    }else if(scope.scope_type==="outcome_type"){
      label=scope.scope_key.replaceAll("_"," ");
    }

    const immutablePayload={
      track_record_run_id:trackRun.id,
      scope_type:scope.scope_type,
      scope_key:scope.scope_key,
      label,
      sample_grade:scope.sample_grade,
      total_forecast_rows:scope.total_forecast_rows,
      verified_sample_size:scope.verified_sample_size,
      unresolved_count:scope.unresolved_count,
      weak_lineage_count:scope.weak_lineage_count,
      unverified_snapshot_count:scope.unverified_snapshot_count,
      numeric_metrics:scope.numeric,
      direction_metrics:scope.direction,
      probability_metrics:{...scope.probability,buckets:undefined},
      confidence_calibration_metrics:{...scope.confidence_calibration,buckets:undefined},
      benchmark_relative_metrics:scope.benchmark_relative,
      caveat:minimumHistoryMessage(scope),
    };
    const snapshotHash=canonicalSha256(immutablePayload);
    const {data:stored,error}=await sb.from("track_record_scope_snapshots").insert({
      ...immutablePayload,
      snapshot_hash:snapshotHash,
    }).select("id").single();
    if(error)throw error;
    snapshotIdByKey.set(scope.scope_type+"|"+scope.scope_key,stored.id);
    records+=1;

    const bucketRows=[
      ...(scope.probability?.buckets??[]).map(b=>({...b,calibration_type:"probability"})),
      ...(scope.confidence_calibration?.buckets??[]).map(b=>({...b,calibration_type:"confidence"})),
    ].map(b=>({
      track_record_scope_snapshot_id:stored.id,
      calibration_type:b.calibration_type,
      lower_bound:b.lower_bound,
      upper_bound:b.upper_bound,
      sample_size:b.sample_size,
      mean_forecast_probability:b.mean_forecast_probability,
      observed_rate:b.observed_rate,
      calibration_gap:b.calibration_gap,
      absolute_calibration_gap:b.absolute_calibration_gap,
      brier_score:b.brier_score,
    }));
    if(bucketRows.length){
      const {error:bucketError}=await sb.from("track_record_calibration_buckets").insert(bucketRows);
      if(bucketError)throw bucketError;
      records+=bucketRows.length;
    }
  }

  const summary={
    methodology_version:TRACK_RECORD_METHODOLOGY_VERSION,
    input_hash:inputHash,
    scopes:scopes.length,
    forecast_rows:global?.total_forecast_rows??0,
    verified_rows:global?.verified_sample_size??0,
    sample_grade:global?.sample_grade??"insufficient",
    caveat:minimumHistoryMessage(global??{}),
    probability_sample:global?.probability?.sample_size??0,
    direction_sample:global?.direction?.sample_size??0,
    numeric_sample:global?.numeric?.sample_size??0,
  };

  await finishRun(automationRunId,"success",records,"Verified track-record evaluation materialized.",summary);
  console.log(JSON.stringify(summary,null,2));
}catch(error){
  await finishRun(
    automationRunId,"failed",records,
    error instanceof Error?error.message:String(error),
    {methodology_version:TRACK_RECORD_METHODOLOGY_VERSION}
  );
  throw error;
}
