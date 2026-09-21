import { randomUUID } from "node:crypto";
import { canonicalSha256 } from "./integrity-hash.mjs";

export const PROVENANCE_VERSION = "evidence-provenance-v1";
export const NORMALIZATION_METHODOLOGY_VERSION = "canonical-fact-v1";

export const SOURCE_QUALITY_RANK = Object.freeze({
  primary_regulatory: 1,
  company_direct: 2,
  structured_provider: 3,
  verified_secondary: 4,
  derived_calculation: 5,
  analyst_assumption: 6,
});

export function sourceQualityClass({ provider = "", sourceType = "", url = "", basis = "reported" } = {}) {
  if (basis === "assumption") return "analyst_assumption";
  if (basis === "derived") return "derived_calculation";
  const p = String(provider).toLowerCase();
  const t = String(sourceType).toLowerCase();
  const u = String(url).toLowerCase();
  if (u.includes("sec.gov") || p.includes("sec") || /10-k|10-q|8-k|20-f|6-k|13f|form 4/.test(t)) {
    return "primary_regulatory";
  }
  if (
    /earnings release|investor presentation|company filing|press release/.test(t) ||
    /investor|ir./.test(u)
  ) return "company_direct";
  if (["fmp","financial_datasets","factset","bloomberg","capital_iq","quiver","marketbeat","yahoo_fundamentals","alpha_vantage"].some((x) => p.includes(x))) {
    return "structured_provider";
  }
  return "verified_secondary";
}

export function qualityRank(value) {
  return SOURCE_QUALITY_RANK[value] ?? 99;
}

function n(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function materialNumericConflict(a, b, { relativePct = 5, absolute = 0 } = {}) {
  const x=n(a), y=n(b);
  if(x==null||y==null) return false;
  const diff=Math.abs(x-y);
  if(diff<=absolute) return false;
  const scale=Math.max(Math.abs(x),Math.abs(y),1e-12);
  return (diff/scale)*100 > relativePct;
}

export function compareObservations(a,b) {
  const quality = qualityRank(a.source_quality_class) - qualityRank(b.source_quality_class);
  if (quality !== 0) return quality;
  const known = String(b.known_at ?? "").localeCompare(String(a.known_at ?? ""));
  if (known !== 0) return known;
  const provider = String(a.provider ?? "").localeCompare(String(b.provider ?? ""));
  if (provider !== 0) return provider;
  return String(a.id ?? a.observation_key ?? "").localeCompare(String(b.id ?? b.observation_key ?? ""));
}

export function selectCanonicalObservation(observations = [], options = {}) {
  const eligible=[...observations].filter((row)=>row && (row.raw_value_numeric!=null || row.raw_value_text!=null));
  if(!eligible.length) {
    return {
      selected:null,
      conflict_state:"unavailable",
      conflicting:[],
      supporting:[],
      selection_reason:"No eligible observation was available.",
      confidence_metadata:{supporting_observation_count:0,independent_provider_count:0,material_conflict:false},
    };
  }
  eligible.sort(compareObservations);
  const preferredObservationId=options.preferredObservationId??null;
  const preferred=preferredObservationId
    ? eligible.find((row)=>row.id===preferredObservationId)
    : null;
  const selected=preferred??eligible[0];
  const selectedNumeric=n(selected.raw_value_numeric);
  const selectedText=selected.raw_value_text==null?null:String(selected.raw_value_text);
  const conflicting=[];
  const supporting=[];
  for(const row of eligible.slice(1)) {
    const numericConflict=selectedNumeric!=null && n(row.raw_value_numeric)!=null
      ? materialNumericConflict(selectedNumeric,row.raw_value_numeric,options)
      : false;
    const textConflict=selectedNumeric==null && selectedText!=null && row.raw_value_text!=null
      ? selectedText.trim().toLowerCase()!==String(row.raw_value_text).trim().toLowerCase()
      : false;
    if(numericConflict||textConflict) conflicting.push(row);
    else supporting.push(row);
  }
  const providers=new Set(eligible.map((row)=>String(row.provider??"unknown")));
  const selectedClass=selected.source_quality_class??"verified_secondary";
  const conflictResolved=Boolean(preferred&&conflicting.length);
  const conflict_state=conflicting.length
    ? (conflictResolved ? "verified" : "conflicting")
    : qualityRank(selectedClass)<=3
      ? "verified"
      : "provisional";
  return {
    selected,
    conflict_state,
    conflicting,
    supporting,
    selection_reason: conflictResolved
      ? "Explicit reviewed source-selection override: "+String(options.resolutionReason??"reason recorded in evidence resolution ledger")
      : conflicting.length
        ? "Selected the highest-authority observation deterministically; material competing observations are preserved and flagged."
        : "Selected the highest-authority available observation using source class, knowledge time, provider, then stable identifier.",
    confidence_metadata:{
      selected_source_quality_class:selectedClass,
      supporting_observation_count:supporting.length+1,
      independent_provider_count:providers.size,
      material_conflict:conflicting.length>0,
      conflict_resolved:conflictResolved,
      resolution_reason:conflictResolved?(options.resolutionReason??null):null,
      conflicting_observation_count:conflicting.length,
      temporal_completeness:Boolean(selected.known_at),
      provenance_completeness:Boolean(selected.source_id),
    }
  };
}

export function observationIdentity(row) {
  return canonicalSha256({
    source_id:row.source_id,
    company_id:row.company_id,
    module:row.module??"universal",
    metric_key:row.metric_key,
    raw_value_numeric:row.raw_value_numeric??null,
    raw_value_text:row.raw_value_text??null,
    unit:row.unit??null,
    economic_period_start:row.economic_period_start??null,
    economic_period_end:row.economic_period_end??null,
    economic_period_type:row.economic_period_type??null,
    observation_at:row.observation_at,
    known_at:row.known_at,
    provider:row.provider,
    basis:row.basis,
  });
}

export function factIdentity({company_id,module="universal",metric_key,value_numeric=null,value_text=null,unit=null,economic_period_start=null,economic_period_end=null,economic_period_type=null,known_at,normalization_methodology_version=NORMALIZATION_METHODOLOGY_VERSION,selected_observation_id=null,conflict_state="provisional",formula_identifier=null,input_fact_ids=[]}) {
  return canonicalSha256({
    company_id,module,metric_key,value_numeric,value_text,unit,
    economic_period_start,economic_period_end,economic_period_type,known_at,
    normalization_methodology_version,selected_observation_id,conflict_state,
    formula_identifier,input_fact_ids:[...input_fact_ids].sort(),
  });
}

export const DERIVED_FORMULAS = Object.freeze({
  fcf_margin:{formula_identifier:"free_cash_flow_div_revenue_pct_v1",inputs:["free_cash_flow","revenue"]},
  price_to_fcf:{formula_identifier:"market_cap_div_free_cash_flow_v1",inputs:["market_cap","free_cash_flow"]},
  fcf_yield:{formula_identifier:"free_cash_flow_div_market_cap_pct_v1",inputs:["free_cash_flow","market_cap"]},
  revenue_growth_1y:{formula_identifier:"revenue_yoy_pct_v1",inputs:["revenue","revenue"]},
  revenue_growth_yoy:{formula_identifier:"revenue_yoy_pct_v1",inputs:["revenue","revenue"]},
  share_count_change_yoy:{formula_identifier:"shares_yoy_pct_v1",inputs:["shares_outstanding","shares_outstanding"]},
  shares_outstanding_growth_yoy:{formula_identifier:"shares_yoy_pct_v1",inputs:["shares_outstanding","shares_outstanding"]},
  valuation_gap:{formula_identifier:"base_fair_value_minus_price_div_base_fair_value_pct_v1",inputs:["base_fair_value","market_price"]},
});

export function derivedFormulaForMetric(metricKey) {
  return DERIVED_FORMULAS[metricKey] ?? null;
}

export function buildNormalizedFact({companyId,module="universal",metricKey,unit=null,economicPeriodStart=null,economicPeriodEnd=null,economicPeriodType=null,observations=[],normalizationMethodologyVersion=NORMALIZATION_METHODOLOGY_VERSION,derivationBasis=null,formulaIdentifier=null,calculationEngineVersion=null,calculatedAt=null,inputFactIds=[],visibility="internal",conflictOptions={}}) {
  const resolution=selectCanonicalObservation(observations,conflictOptions);
  if(!resolution.selected) return null;
  const selected=resolution.selected;
  const knownAt=[selected,...resolution.supporting,...resolution.conflicting]
    .map((row)=>row.known_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  const fact={
    id:randomUUID(),
    company_id:companyId,
    fact_key:null,
    module,
    metric_key:metricKey,
    value_numeric:selected.raw_value_numeric??null,
    value_text:selected.raw_value_text??null,
    unit:unit??selected.unit??null,
    economic_period_start:economicPeriodStart??selected.economic_period_start??null,
    economic_period_end:economicPeriodEnd??selected.economic_period_end??null,
    economic_period_type:economicPeriodType??selected.economic_period_type??null,
    known_at:knownAt,
    normalization_methodology_version:normalizationMethodologyVersion,
    selected_observation_id:selected.id,
    source_confidence_class:selected.source_quality_class??"verified_secondary",
    conflict_state:resolution.conflict_state,
    selection_reason:resolution.selection_reason,
    derivation_basis:derivationBasis,
    formula_identifier:formulaIdentifier,
    calculation_engine_version:calculationEngineVersion,
    calculated_at:calculatedAt,
    confidence_metadata:resolution.confidence_metadata,
    derivation_metadata:{input_fact_ids:[...inputFactIds]},
    visibility,
  };
  fact.fact_key=factIdentity({...fact,input_fact_ids:inputFactIds});
  return {
    fact,
    observationLinks:[
      {normalized_fact_id:fact.id,observation_id:selected.id,observation_role:"selected"},
      ...resolution.supporting.map((row)=>({normalized_fact_id:fact.id,observation_id:row.id,observation_role:"supporting"})),
      ...resolution.conflicting.map((row)=>({normalized_fact_id:fact.id,observation_id:row.id,observation_role:"conflicting"})),
    ],
    inputLinks:inputFactIds.map((id,index)=>({normalized_fact_id:fact.id,input_fact_id:id,input_role:"formula_input",input_order:index})),
  };
}

export function asOfFacts(rows=[],asOf) {
  const cutoff=new Date(asOf).getTime();
  if(!Number.isFinite(cutoff)) throw new Error("Invalid as-of timestamp.");
  return rows.filter((row)=>{
    const t=new Date(row.known_at).getTime();
    return Number.isFinite(t)&&t<=cutoff;
  });
}

export function latestFactAsOf(rows=[],asOf) {
  return asOfFacts(rows,asOf)
    .filter((row)=>row.conflict_state!=="superseded")
    .sort((a,b)=>{
      const period=String(b.economic_period_end??"").localeCompare(String(a.economic_period_end??""));
      if(period)return period;
      return String(b.known_at??"").localeCompare(String(a.known_at??""));
    })[0]??null;
}

export function assertManifestCutoff(items=[],cutoffAt) {
  const cutoff=new Date(cutoffAt).getTime();
  if(!Number.isFinite(cutoff)) throw new Error("Research cutoff is invalid.");
  const future=items.filter((item)=>{
    if(!item?.known_at)return false;
    const t=new Date(item.known_at).getTime();
    return Number.isFinite(t)&&t>cutoff;
  });
  if(future.length) {
    throw new Error("Research input exceeds cutoff: "+future.map((x)=>x.metric_key).join(", "));
  }
  return true;
}

export function manifestHash(manifest) {
  return canonicalSha256({
    manifest_version:manifest.manifest_version,
    company_id:manifest.company_id,
    context_pack_id:manifest.context_pack_id??null,
    cutoff_at:manifest.cutoff_at,
    provenance_status:manifest.provenance_status,
    items:[...(manifest.items??[])].sort((a,b)=>
      [a.input_role??"",a.module??"",a.metric_key??"",a.economic_period_end??"",a.normalized_fact_id??""].join("|")
        .localeCompare([b.input_role??"",b.module??"",b.metric_key??"",b.economic_period_end??"",b.normalized_fact_id??""].join("|"))
    ),
  });
}
