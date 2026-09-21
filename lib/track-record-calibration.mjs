export const TRACK_RECORD_METHODOLOGY_VERSION="track-record-v1";
export const CALIBRATION_BUCKET_VERSION="calibration-buckets-20pct-v1";

const n=(v)=>{
  if(v===null||v===undefined||v==="")return null;
  const x=Number(v);
  return Number.isFinite(x)?x:null;
};
const round=(v,d=4)=>v==null?null:Math.round(v*10**d)/10**d;
const mean=(xs)=>{
  const v=xs.map(n).filter(x=>x!=null);
  return v.length?v.reduce((a,b)=>a+b,0)/v.length:null;
};
const median=(xs)=>{
  const v=xs.map(n).filter(x=>x!=null).sort((a,b)=>a-b);
  if(!v.length)return null;
  const m=Math.floor(v.length/2);
  return v.length%2?v[m]:(v[m-1]+v[m])/2;
};
const rmse=(xs)=>{
  const v=xs.map(n).filter(x=>x!=null);
  return v.length?Math.sqrt(v.reduce((s,x)=>s+x*x,0)/v.length):null;
};
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));

export function sampleGrade(nValue){
  const count=Number(nValue??0);
  if(count>=50)return "robust";
  if(count>=20)return "meaningful";
  if(count>=5)return "emerging";
  return "insufficient";
}

export function verificationState(row={}){
  if(!row.locked_at)return "unverified_snapshot";
  if(!row.realized_outcome_id)return "unresolved";
  if(row.actual_value==null&&row.actual_text==null)return "unresolved";
  if(!row.source_note&&!row.source_url)return "weak_lineage";
  return "verified";
}

export function numericForecastObservation(row={}){
  const predicted=n(row.predicted_value),actual=n(row.actual_value);
  if(predicted==null||actual==null)return null;
  const signed=actual-predicted;
  const abs=Math.abs(signed);
  const ape=actual===0?null:abs/Math.abs(actual)*100;
  const denom=(Math.abs(actual)+Math.abs(predicted))/2;
  const smape=denom===0?0:abs/denom*100;
  const intervalLow=n(row.predicted_low),intervalHigh=n(row.predicted_high);
  const hasInterval=intervalLow!=null&&intervalHigh!=null&&intervalLow<=intervalHigh;
  return{
    signed_error:signed,
    absolute_error:abs,
    absolute_percentage_error:ape,
    symmetric_ape:smape,
    squared_error:signed*signed,
    interval_available:hasInterval,
    interval_hit:hasInterval?actual>=intervalLow&&actual<=intervalHigh:null,
    interval_width:hasInterval?intervalHigh-intervalLow:null,
  };
}

export function probabilityForecastObservation(row={}){
  const pRaw=n(row.predicted_probability),actual=n(row.actual_value);
  if(pRaw==null||actual==null||![0,1].includes(actual))return null;
  const p=clamp(pRaw/100,0,1);
  const eps=1e-12;
  const logLoss=-(actual*Math.log(Math.max(p,eps))+(1-actual)*Math.log(Math.max(1-p,eps)));
  return{
    probability:p,
    actual,
    brier:(p-actual)**2,
    log_loss:logLoss,
    class_correct:(p>=.5&&actual===1)||(p<.5&&actual===0),
  };
}

export function directionObservation(row={}){
  if(typeof row.direction_correct==="boolean")return row.direction_correct;
  const predicted=n(row.predicted_value),actual=n(row.actual_value);
  if(predicted==null||actual==null)return null;
  return Math.sign(predicted)===Math.sign(actual);
}

export function calibrationBuckets(rows=[],{
  probabilityField="predicted_probability",
  outcomeField="actual_value",
  bucketWidth=20,
}={}){
  const buckets=[];
  for(let lower=0;lower<100;lower+=bucketWidth){
    const upper=Math.min(100,lower+bucketWidth);
    const members=rows.filter(row=>{
      const p=n(row[probabilityField]);
      const y=n(row[outcomeField]);
      if(p==null||y==null||![0,1].includes(y))return false;
      return p>=lower&&(p<upper||(upper===100&&p<=upper));
    });
    if(!members.length)continue;
    const probs=members.map(r=>n(r[probabilityField])/100);
    const actuals=members.map(r=>n(r[outcomeField]));
    const avgP=mean(probs);
    const observed=mean(actuals);
    buckets.push({
      lower_bound:lower,
      upper_bound:upper,
      sample_size:members.length,
      mean_forecast_probability:round(avgP*100,2),
      observed_rate:round(observed*100,2),
      calibration_gap:round((avgP-observed)*100,2),
      absolute_calibration_gap:round(Math.abs(avgP-observed)*100,2),
      brier_score:round(mean(members.map(r=>(n(r[probabilityField])/100-n(r[outcomeField]))**2)),6),
    });
  }
  return buckets;
}

export function expectedCalibrationError(buckets=[]){
  const total=buckets.reduce((s,b)=>s+Number(b.sample_size??0),0);
  if(!total)return null;
  return buckets.reduce((s,b)=>s+(Number(b.sample_size)/total)*(Number(b.absolute_calibration_gap)/100),0);
}

export function confidenceCalibrationBuckets(rows=[],bucketWidth=20){
  const eligible=rows.filter(r=>n(r.snapshot_confidence)!=null&&typeof directionObservation(r)==="boolean");
  return calibrationBuckets(eligible.map(r=>({
    predicted_probability:n(r.snapshot_confidence),
    actual_value:directionObservation(r)?1:0,
  })),{bucketWidth});
}

export function aggregateTrackRecord(rows=[]){
  const verified=rows.filter(r=>verificationState(r)==="verified");
  const numeric=verified.map(numericForecastObservation).filter(Boolean);
  const probability=verified.map(probabilityForecastObservation).filter(Boolean);
  const directions=verified.map(directionObservation).filter(v=>typeof v==="boolean");
  const relative=verified.filter(r=>n(r.benchmark_excess_return)!=null);
  const intervals=numeric.filter(x=>x.interval_available);
  const probBuckets=calibrationBuckets(verified);
  const confBuckets=confidenceCalibrationBuckets(verified);

  const signed=numeric.map(x=>x.signed_error);
  const abs=numeric.map(x=>x.absolute_error);
  const ape=numeric.map(x=>x.absolute_percentage_error).filter(x=>x!=null);
  const smape=numeric.map(x=>x.symmetric_ape);
  const errorsSquared=numeric.map(x=>x.squared_error);
  const excess=relative.map(r=>n(r.benchmark_excess_return));
  const verifiedCount=verified.length;

  return{
    methodology_version:TRACK_RECORD_METHODOLOGY_VERSION,
    total_forecast_rows:rows.length,
    verified_sample_size:verifiedCount,
    unresolved_count:rows.filter(r=>verificationState(r)==="unresolved").length,
    weak_lineage_count:rows.filter(r=>verificationState(r)==="weak_lineage").length,
    unverified_snapshot_count:rows.filter(r=>verificationState(r)==="unverified_snapshot").length,
    sample_grade:sampleGrade(verifiedCount),

    numeric:{
      sample_size:numeric.length,
      mae:round(mean(abs),6),
      rmse:round(rmse(signed),6),
      mean_signed_error:round(mean(signed),6),
      mape:round(mean(ape),4),
      median_ape:round(median(ape),4),
      smape:round(mean(smape),4),
      interval_count:intervals.length,
      interval_coverage:intervals.length?round(intervals.filter(x=>x.interval_hit).length/intervals.length*100,2):null,
      mean_interval_width:intervals.length?round(mean(intervals.map(x=>x.interval_width)),6):null,
    },

    direction:{
      sample_size:directions.length,
      correct_count:directions.filter(Boolean).length,
      accuracy:directions.length?round(directions.filter(Boolean).length/directions.length*100,2):null,
    },

    probability:{
      sample_size:probability.length,
      brier_score:round(mean(probability.map(x=>x.brier)),6),
      log_loss:round(mean(probability.map(x=>x.log_loss)),6),
      class_accuracy:probability.length?round(probability.filter(x=>x.class_correct).length/probability.length*100,2):null,
      expected_calibration_error:round(expectedCalibrationError(probBuckets),6),
      buckets:probBuckets,
    },

    confidence_calibration:{
      sample_size:confBuckets.reduce((s,b)=>s+b.sample_size,0),
      expected_calibration_error:round(expectedCalibrationError(confBuckets),6),
      buckets:confBuckets,
    },

    benchmark_relative:{
      sample_size:relative.length,
      mean_excess_return:round(mean(excess),4),
      median_excess_return:round(median(excess),4),
      benchmark_win_rate:relative.length?round(excess.filter(v=>v>0).length/relative.length*100,2):null,
    },
  };
}

function keyValue(row,key){
  if(key==="company")return row.company_id??null;
  if(key==="model")return row.model_version??null;
  if(key==="horizon")return row.horizon_months==null?null:String(row.horizon_months);
  if(key==="outcome_type")return row.outcome_type??null;
  if(key==="metric")return row.metric_key??null;
  return null;
}

export function buildTrackRecordScopes(rows=[]){
  const scopes=[{
    scope_type:"global",
    scope_key:"all",
    label:"All verified forecasts",
    rows,
  }];
  for(const [scopeType,key] of [
    ["company","company"],
    ["model","model"],
    ["horizon","horizon"],
    ["outcome_type","outcome_type"],
    ["metric","metric"],
  ]){
    const groups=new Map();
    for(const row of rows){
      const value=keyValue(row,key);
      if(value==null)continue;
      const k=String(value);
      const list=groups.get(k)??[];
      list.push(row);
      groups.set(k,list);
    }
    for(const [scopeKey,group] of groups){
      scopes.push({
        scope_type:scopeType,
        scope_key:scopeKey,
        label:scopeType+" "+scopeKey,
        rows:group,
      });
    }
  }
  return scopes.map(scope=>({
    scope_type:scope.scope_type,
    scope_key:scope.scope_key,
    label:scope.label,
    ...aggregateTrackRecord(scope.rows),
  }));
}

export function minimumHistoryMessage(summary={}){
  const nVerified=Number(summary.verified_sample_size??0);
  if(nVerified>=50)return "Robust sample: calibration metrics are suitable for model monitoring, subject to forecast dependence and regime change.";
  if(nVerified>=20)return "Meaningful sample: calibration is informative but still sensitive to model mix and market regime.";
  if(nVerified>=5)return "Emerging sample: show metrics, but avoid strong conclusions about forecasting skill.";
  return "Insufficient verified history: preserve the ledger and report outcomes, but do not claim forecasting skill yet.";
}

export function publicTrackRecordSummary(summary={}){
  return{
    sample_size:Number(summary.verified_sample_size??0),
    sample_grade:summary.sample_grade??sampleGrade(summary.verified_sample_size),
    direction_accuracy:summary.direction?.accuracy??null,
    brier_score:summary.probability?.brier_score??null,
    calibration_error:summary.probability?.expected_calibration_error??null,
    numeric_median_ape:summary.numeric?.median_ape??null,
    benchmark_win_rate:summary.benchmark_relative?.benchmark_win_rate??null,
    caveat:minimumHistoryMessage(summary),
  };
}
