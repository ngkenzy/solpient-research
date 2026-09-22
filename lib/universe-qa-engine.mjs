import {
  SCREEN_STATE,
  UNIVERSE_SCREENING_VERSION,
  selectSolpient100Candidates,
} from "./universe-screening-engine.mjs";

export const UNIVERSE_QA_VERSION="universe-qa-v1";

export const DEFAULT_QA_THRESHOLDS=Object.freeze({
  shortlist_limit:100,
  max_shortlist_profile_pct:40,
  max_unknown_classification_pct:10,
  max_unknown_shortlist_count:0,
  min_shortlist_effective_coverage_pct:60,
  min_shortlist_median_effective_coverage_pct:70,
  high_score_threshold:85,
  high_score_low_coverage_threshold:70,
  extreme_score_threshold:95,
  extreme_score_min_raw_coverage_pct:80,
  coverage_compression_warning_pct:10,
  value_trap_valuation_score:80,
  value_trap_quality_core_score:50,
  expensive_compounder_quality_core_score:85,
  expensive_compounder_valuation_score:35,
  max_duplicate_ticker_count:0,
  max_duplicate_issuer_count:0,
});

const n=(v)=>{
  if(v===null||v===undefined||v==="")return null;
  const x=Number(v);
  return Number.isFinite(x)?x:null;
};
const round=(v,d=1)=>v==null?null:Math.round(v*10**d)/10**d;
const pct=(num,den)=>den?round(num/den*100,1):0;
const median=(values=[])=>{
  const xs=values.filter(v=>n(v)!=null).map(Number).sort((a,b)=>a-b);
  if(!xs.length)return null;
  const mid=Math.floor(xs.length/2);
  return xs.length%2?xs[mid]:(xs[mid-1]+xs[mid])/2;
};
const avg=(values=[])=>{
  const xs=values.filter(v=>n(v)!=null).map(Number);
  return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
};
const normalizeTicker=(v)=>String(v??"").trim().toUpperCase();
const normalizeText=(v)=>String(v??"").trim();

function countBy(rows,keyFn){
  const map=new Map();
  for(const row of rows){
    const key=String(keyFn(row)??"Unknown")||"Unknown";
    map.set(key,(map.get(key)??0)+1);
  }
  return [...map.entries()].map(([key,count])=>({key,count}))
    .sort((a,b)=>b.count-a.count||a.key.localeCompare(b.key));
}

function duplicateDiagnostics(rows=[]){
  const tickerMap=new Map();
  const issuerMap=new Map();
  for(const row of rows){
    const ticker=normalizeTicker(row.ticker);
    if(ticker){
      const list=tickerMap.get(ticker)??[];
      list.push(row);tickerMap.set(ticker,list);
    }
    const cik=String(row.cik??"").replace(/\D/g,"");
    if(cik){
      const list=issuerMap.get(cik)??[];
      list.push(row);issuerMap.set(cik,list);
    }
  }
  const duplicateTickers=[...tickerMap.entries()]
    .filter(([,list])=>list.length>1)
    .map(([ticker,list])=>({
      ticker,
      count:list.length,
      names:[...new Set(list.map(x=>x.company_name??x.companyName??ticker))],
    }));
  const duplicateIssuers=[...issuerMap.entries()]
    .filter(([,list])=>list.length>1)
    .map(([cik,list])=>({
      cik,
      count:list.length,
      tickers:[...new Set(list.map(x=>normalizeTicker(x.ticker)).filter(Boolean))],
      names:[...new Set(list.map(x=>x.company_name??x.companyName??cik))],
    }));
  return{duplicateTickers,duplicateIssuers};
}

function missingMetricDiagnostics(screened=[]){
  const counts=new Map();
  const eligible=screened.filter(r=>r.state!==SCREEN_STATE.EXCLUDED);
  for(const row of eligible){
    for(const [dimensionName,dimension] of Object.entries(row.dimensions??{})){
      for(const key of dimension?.missing??[]){
        const id=dimensionName+"."+key;
        const item=counts.get(id)??{metric:id,count:0,dimension:dimensionName};
        item.count+=1;counts.set(id,item);
      }
    }
    for(const missing of row.sectorEvidence?.missingCriticalEvidence??[]){
      const id="sector."+missing.key;
      const item=counts.get(id)??{
        metric:id,count:0,dimension:"sector",
        label:missing.label,
      };
      item.count+=1;counts.set(id,item);
    }
  }
  return [...counts.values()].map(item=>({
    ...item,
    eligible_pct:pct(item.count,eligible.length),
  })).sort((a,b)=>b.count-a.count||a.metric.localeCompare(b.metric));
}

function gateDiagnostics(screened=[]){
  const map=new Map();
  for(const row of screened){
    for(const gate of row.gates??[]){
      if(gate.pass)continue;
      const item=map.get(gate.key)??{
        gate:gate.key,count:0,reason:gate.reason??null,
      };
      item.count+=1;map.set(gate.key,item);
    }
  }
  return [...map.values()].map(item=>({
    ...item,
    input_pct:pct(item.count,screened.length),
  })).sort((a,b)=>b.count-a.count||a.gate.localeCompare(b.gate));
}

function dataQuality(rows=[]){
  const total=rows.length;
  const fields=[
    "price","market_cap","avg_dollar_volume_30d","roic","roe","fcf_margin",
    "cash_conversion_pct","operating_margin","revenue_growth_3y_cagr",
    "eps_growth_3y_cagr","fcf_growth_3y_cagr","price_to_fcf",
    "trailing_pe","ev_to_ebitda",
  ];
  const completeness=fields.map(field=>{
    const present=rows.filter(row=>n(row?.[field])!=null).length;
    return{field,present,missing:total-present,present_pct:pct(present,total)};
  }).sort((a,b)=>a.present_pct-b.present_pct||a.field.localeCompare(b.field));

  const temporaryMarketSource=rows.filter(row=>row?._market_metadata?.temporary_source===true).length;
  const missingClassification=rows.filter(row=>{
    const sector=normalizeText(row.sector).toLowerCase();
    return !sector||sector==="unknown"||sector==="services";
  }).length;
  const sparseLiquidity=rows.filter(row=>n(row.avg_dollar_volume_30d)==null).length;
  const missingMarketCap=rows.filter(row=>n(row.market_cap)==null).length;
  const missingPrice=rows.filter(row=>n(row.price)==null).length;

  return{
    fieldCompleteness:completeness,
    temporaryMarketSourceCount:temporaryMarketSource,
    temporaryMarketSourcePct:pct(temporaryMarketSource,total),
    missingClassificationCount:missingClassification,
    missingClassificationPct:pct(missingClassification,total),
    sparseLiquidityCount:sparseLiquidity,
    sparseLiquidityPct:pct(sparseLiquidity,total),
    missingMarketCapCount:missingMarketCap,
    missingMarketCapPct:pct(missingMarketCap,total),
    missingPriceCount:missingPrice,
    missingPricePct:pct(missingPrice,total),
  };
}

function outlierDiagnostics(screened=[]){
  const highScoreLowCoverage=[];
  const extremeScoreThinEvidence=[];
  const evidenceCompressed=[];
  const valueTraps=[];
  const expensiveCompounders=[];
  const sectorEvidenceBlocked=[];

  for(const row of screened){
    const score=n(row.screenScore),quality=n(row.qualityCoreScore);
    const coverage=n(row.evidenceCoveragePct),raw=n(row.rawEvidenceCoveragePct);
    const valuation=n(row.dimensions?.valuation?.score);
    const compression=raw!=null&&coverage!=null?raw-coverage:null;
    const summary={
      ticker:row.ticker,
      company_name:row.companyName,
      state:row.state,
      profile:row.profile,
      screen_score:score,
      quality_core_score:quality,
      valuation_score:valuation,
      raw_coverage_pct:raw,
      effective_coverage_pct:coverage,
      evidence_ceiling_pct:n(row.sectorEvidence?.evidenceCoverageCeilingPct),
      critical_sector_evidence_pct:n(row.sectorEvidence?.criticalEvidenceCoveragePct),
      shortlist_rank:row.shortlistRank,
    };
    if(score!=null&&score>=85&&coverage!=null&&coverage<70)highScoreLowCoverage.push(summary);
    if(score!=null&&score>=95&&raw!=null&&raw<80)extremeScoreThinEvidence.push(summary);
    if(compression!=null&&compression>=10)evidenceCompressed.push({...summary,coverage_compression_pct:round(compression)});
    if(valuation!=null&&valuation>=80&&quality!=null&&quality<50)valueTraps.push(summary);
    if(quality!=null&&quality>=85&&valuation!=null&&valuation<35)expensiveCompounders.push(summary);
    if(row.sectorEvidence?.missingCriticalEvidence?.length){
      sectorEvidenceBlocked.push({
        ...summary,
        missing:row.sectorEvidence.missingCriticalEvidence.map(x=>x.label),
      });
    }
  }
  const sortScore=(a,b)=>(b.screen_score??-1)-(a.screen_score??-1)||a.ticker.localeCompare(b.ticker);
  for(const list of [highScoreLowCoverage,extremeScoreThinEvidence,evidenceCompressed,valueTraps,expensiveCompounders,sectorEvidenceBlocked]){
    list.sort(sortScore);
  }
  return{
    highScoreLowCoverage,
    extremeScoreThinEvidence,
    evidenceCompressed,
    valueTraps,
    expensiveCompounders,
    sectorEvidenceBlocked,
  };
}

function topDistribution(rows=[],keyFn,total=rows.length){
  return countBy(rows,keyFn).map(item=>({
    ...item,
    pct:pct(item.count,total),
  }));
}

function qaFindings({rows,screened,shortlist,duplicates,quality,distribution,outliers,thresholds}){
  const findings=[];
  const add=(severity,key,message,details={})=>findings.push({severity,key,message,...details});

  if(duplicates.duplicateTickers.length>thresholds.max_duplicate_ticker_count){
    add("blocker","duplicate_tickers",
      duplicates.duplicateTickers.length+" duplicate ticker identities exist in the input universe.",
      {count:duplicates.duplicateTickers.length});
  }
  if(duplicates.duplicateIssuers.length>thresholds.max_duplicate_issuer_count){
    add("blocker","duplicate_issuers",
      duplicates.duplicateIssuers.length+" duplicate issuer/CIK identities remain after feed canonicalization.",
      {count:duplicates.duplicateIssuers.length});
  }

  const unknownPct=quality.missingClassificationPct;
  if(unknownPct>thresholds.max_unknown_classification_pct){
    add("review","unknown_classification_rate",
      unknownPct+"% of input companies still have Unknown/unsupported sector classification.",
      {actual:unknownPct,limit:thresholds.max_unknown_classification_pct});
  }

  const unknownShortlist=shortlist.filter(row=>{
    const sector=normalizeText(row.sector).toLowerCase();
    return row.profile==="general"&&(!sector||sector==="unknown"||sector==="services");
  });
  if(unknownShortlist.length>thresholds.max_unknown_shortlist_count){
    add("blocker","unknown_shortlist_promotion",
      unknownShortlist.length+" Unknown/general names entered the deep-research shortlist.",
      {count:unknownShortlist.length,tickers:unknownShortlist.map(x=>x.ticker)});
  }

  const invalidCandidateCoverage=screened.filter(row=>
    [SCREEN_STATE.SOLPIENT_100_CANDIDATE,SCREEN_STATE.SOLPIENT_100].includes(row.state)&&
    (n(row.evidenceCoveragePct)??0)<70
  );
  if(invalidCandidateCoverage.length){
    add("blocker","candidate_coverage_violation",
      invalidCandidateCoverage.length+" Solpient 100 candidate/member rows are below the 70% effective evidence threshold.",
      {tickers:invalidCandidateCoverage.map(x=>x.ticker)});
  }

  const shortlistCoverage=shortlist.map(x=>n(x.evidenceCoveragePct)).filter(x=>x!=null);
  const shortlistMedian=median(shortlistCoverage);
  const shortlistMin=shortlistCoverage.length?Math.min(...shortlistCoverage):null;
  if(shortlist.length&&shortlistMin!=null&&shortlistMin<thresholds.min_shortlist_effective_coverage_pct){
    add("review","shortlist_low_coverage",
      "At least one shortlisted company is below the preferred "+thresholds.min_shortlist_effective_coverage_pct+"% effective coverage floor.",
      {actual:shortlistMin});
  }
  if(shortlist.length&&shortlistMedian!=null&&shortlistMedian<thresholds.min_shortlist_median_effective_coverage_pct){
    add("review","shortlist_median_coverage",
      "Median shortlist effective coverage is "+shortlistMedian+"%, below the "+thresholds.min_shortlist_median_effective_coverage_pct+"% QA target.",
      {actual:shortlistMedian,limit:thresholds.min_shortlist_median_effective_coverage_pct});
  }

  const topProfile=distribution.shortlistProfiles[0];
  if(topProfile&&topProfile.pct>thresholds.max_shortlist_profile_pct){
    add("review","shortlist_profile_concentration",
      topProfile.key+" represents "+topProfile.pct+"% of the shortlist.",
      {profile:topProfile.key,actual:topProfile.pct,limit:thresholds.max_shortlist_profile_pct});
  }

  if(outliers.highScoreLowCoverage.length){
    add("review","high_score_low_coverage",
      outliers.highScoreLowCoverage.length+" companies have high economic scores but sub-70% effective evidence.",
      {count:outliers.highScoreLowCoverage.length});
  }
  if(outliers.extremeScoreThinEvidence.length){
    add("review","extreme_score_thin_evidence",
      outliers.extremeScoreThinEvidence.length+" companies score at least 95 with less than 80% raw evidence coverage.",
      {count:outliers.extremeScoreThinEvidence.length});
  }

  const screeningInvariantViolations=screened.filter(row=>
    row.sectorEvidence?.candidatePromotionBlocked&&
    [SCREEN_STATE.SOLPIENT_100_CANDIDATE,SCREEN_STATE.SOLPIENT_100].includes(row.state)
  );
  if(screeningInvariantViolations.length){
    add("blocker","sector_promotion_block_violation",
      "A sector-evidence promotion block was bypassed.",
      {tickers:screeningInvariantViolations.map(x=>x.ticker)});
  }

  if(!rows.length)add("blocker","empty_universe","Universe input contains no securities.");
  if(!shortlist.length&&screened.length)add("review","empty_shortlist","No companies qualified for the deep-research shortlist.");

  return findings.sort((a,b)=>{
    const sev={blocker:0,review:1,info:2};
    return sev[a.severity]-sev[b.severity]||a.key.localeCompare(b.key);
  });
}

export function buildUniverseQAReport(inputRows=[],options={}){
  const rows=Array.isArray(inputRows)?inputRows:[];
  const thresholds={...DEFAULT_QA_THRESHOLDS,...(options.thresholds??{})};
  const limit=Math.max(1,Number(options.limit??thresholds.shortlist_limit) || 100);

  const normalized=rows.map(row=>({...row,ticker:normalizeTicker(row.ticker)}));
  const duplicates=duplicateDiagnostics(normalized);

  // Preserve duplicates for QA diagnostics, but use one deterministic row per ticker for screening
  // so the QA console can still produce a report instead of crashing on bad input.
  const uniqueByTicker=new Map();
  for(const row of normalized){
    if(!row.ticker)continue;
    if(!uniqueByTicker.has(row.ticker))uniqueByTicker.set(row.ticker,row);
  }
  const screeningRows=[...uniqueByTicker.values()].sort((a,b)=>a.ticker.localeCompare(b.ticker));
  const screened=selectSolpient100Candidates(screeningRows,{limit});
  const shortlist=screened.filter(row=>row.proposedForDeepResearch);

  const funnel={
    input_count:normalized.length,
    unique_ticker_count:screeningRows.length,
    screened_count:screened.length,
    excluded:screened.filter(r=>r.state===SCREEN_STATE.EXCLUDED).length,
    watch:screened.filter(r=>r.state===SCREEN_STATE.WATCH).length,
    research_candidate:screened.filter(r=>r.state===SCREEN_STATE.RESEARCH_CANDIDATE).length,
    solpient_100_candidate:screened.filter(r=>r.state===SCREEN_STATE.SOLPIENT_100_CANDIDATE).length,
    solpient_100:screened.filter(r=>r.state===SCREEN_STATE.SOLPIENT_100).length,
    proposed_deep_research:shortlist.length,
  };

  const distribution={
    inputProfiles:topDistribution(screened,r=>r.profile,screened.length),
    shortlistProfiles:topDistribution(shortlist,r=>r.profile,shortlist.length),
    inputSectors:topDistribution(screened,r=>r.sector??"Unknown",screened.length),
    shortlistSectors:topDistribution(shortlist,r=>r.sector??"Unknown",shortlist.length),
    states:topDistribution(screened,r=>r.state,screened.length),
  };

  const coverage={
    raw_average_pct:round(avg(screened.map(r=>r.rawEvidenceCoveragePct))),
    raw_median_pct:round(median(screened.map(r=>r.rawEvidenceCoveragePct))),
    effective_average_pct:round(avg(screened.map(r=>r.evidenceCoveragePct))),
    effective_median_pct:round(median(screened.map(r=>r.evidenceCoveragePct))),
    shortlist_effective_average_pct:round(avg(shortlist.map(r=>r.evidenceCoveragePct))),
    shortlist_effective_median_pct:round(median(shortlist.map(r=>r.evidenceCoveragePct))),
    ceiling_applied_count:screened.filter(r=>
      n(r.sectorEvidence?.evidenceCoverageCeilingPct)!=null&&
      n(r.sectorEvidence?.evidenceCoverageCeilingPct)<100
    ).length,
    sector_sensitive_count:screened.filter(r=>r.sectorEvidence?.sensitive===true).length,
    critical_sector_evidence_average_pct:round(avg(
      screened.map(r=>r.sectorEvidence?.criticalEvidenceCoveragePct)
    )),
  };

  const quality=dataQuality(normalized);
  const missing=missingMetricDiagnostics(screened);
  const gates=gateDiagnostics(screened);
  const outliers=outlierDiagnostics(screened);

  const findings=qaFindings({
    rows:normalized,screened,shortlist,duplicates,quality,distribution,outliers,thresholds,
  });
  const blockers=findings.filter(x=>x.severity==="blocker");
  const reviews=findings.filter(x=>x.severity==="review");
  const status=(blockers.length||reviews.length)?"review_required":"pass";

  return{
    qa_version:UNIVERSE_QA_VERSION,
    screening_methodology_version:UNIVERSE_SCREENING_VERSION,
    generated_at:new Date().toISOString(),
    status,
    thresholds,
    funnel,
    coverage,
    distribution,
    quality,
    duplicates,
    missing_metrics:missing,
    gate_failures:gates,
    outliers,
    findings,
    blockers:blockers.length,
    review_items:reviews.length,
    top_shortlist:shortlist.slice(0,Math.min(limit,100)).map(row=>({
      rank:row.shortlistRank,
      ticker:row.ticker,
      company_name:row.companyName,
      sector:row.sector,
      profile:row.profile,
      state:row.state,
      screen_score:row.screenScore,
      quality_core_score:row.qualityCoreScore,
      valuation_score:row.dimensions?.valuation?.score??null,
      raw_coverage_pct:row.rawEvidenceCoveragePct,
      effective_coverage_pct:row.evidenceCoveragePct,
      evidence_ceiling_pct:row.sectorEvidence?.evidenceCoverageCeilingPct??100,
      critical_sector_evidence_pct:row.sectorEvidence?.criticalEvidenceCoveragePct??null,
      missing_critical_sector_evidence:(row.sectorEvidence?.missingCriticalEvidence??[]).map(x=>x.label),
    })),
  };
}
