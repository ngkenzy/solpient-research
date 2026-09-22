export const SECTOR_EVIDENCE_MODEL_VERSION="solpient-sector-evidence-model-v2.1";

const n=(v)=>{
  if(v===null||v===undefined||v==="")return null;
  const x=Number(v);
  return Number.isFinite(x)?x:null;
};
const round1=(v)=>v==null?null:Math.round(v*10)/10;
const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,v));

function hasValue(v){
  if(v===null||v===undefined||v==="")return false;
  if(typeof v==="number")return Number.isFinite(v);
  if(typeof v==="boolean")return true;
  if(typeof v==="string")return v.trim().length>0;
  return true;
}

function pathValue(row,path){
  const direct=row?.[path];
  if(hasValue(direct))return direct;
  const nested=row?.sector_evidence?.[path];
  if(hasValue(nested))return nested;
  return null;
}

function groupSatisfied(row,group){
  return group.fields.some(field=>hasValue(pathValue(row,field)));
}

const DEFINITIONS=Object.freeze({
  bank:{
    reservedEvidencePct:40,
    critical:[
      {key:"capital_adequacy",label:"CET1 or reviewed regulatory capital",fields:["cet1_ratio","regulatory_capital_ratio"]},
      {key:"net_interest_margin",label:"Net interest margin",fields:["net_interest_margin","nim_pct"]},
      {key:"operating_efficiency",label:"Efficiency ratio",fields:["efficiency_ratio"]},
      {key:"asset_quality",label:"Non-performing assets/loans",fields:["nonperforming_assets_pct","nonperforming_loans_pct"]},
      {key:"credit_losses",label:"Credit-loss / provision quality",fields:["credit_loss_ratio","provision_for_credit_losses_pct","net_charge_off_rate"]},
    ],
  },
  insurance:{
    reservedEvidencePct:40,
    critical:[
      {key:"underwriting_profitability",label:"Combined ratio / underwriting profitability",fields:["combined_ratio","underwriting_margin_pct"]},
      {key:"reserve_quality",label:"Reserve development",fields:["reserve_development_pct","prior_year_reserve_development_pct"]},
      {key:"statutory_capital",label:"Statutory capital / solvency",fields:["rbc_ratio","statutory_capital_ratio","solvency_ratio"]},
      {key:"premium_quality",label:"Premium growth quality",fields:["premium_growth_pct","net_premiums_written_growth_pct"]},
      {key:"catastrophe_exposure",label:"Catastrophe / concentration exposure",fields:["catastrophe_exposure_pct","cat_loss_ratio","geographic_concentration_pct"]},
    ],
  },
  asset_manager:{
    reservedEvidencePct:35,
    critical:[
      {key:"assets_under_management",label:"AUM / AUA scale and trend",fields:["aum","aua","aum_growth_pct","aua_growth_pct"]},
      {key:"organic_flows",label:"Organic net flows",fields:["organic_net_flows_pct","net_flows_pct"]},
      {key:"fee_rate",label:"Fee-rate trend",fields:["fee_rate_bps","management_fee_rate_bps"]},
      {key:"client_concentration",label:"Client concentration",fields:["client_concentration_pct","top_10_client_pct"]},
      {key:"market_sensitivity",label:"Market/performance-fee sensitivity",fields:["performance_fee_dependency_pct","market_sensitive_revenue_pct"]},
    ],
  },
  financial_other:{
    reservedEvidencePct:35,
    critical:[
      {key:"capital_adequacy",label:"Business-specific capital adequacy",fields:["capital_adequacy_ratio","regulatory_capital_ratio"]},
      {key:"credit_quality",label:"Credit / receivables quality",fields:["credit_loss_ratio","delinquency_rate","nonperforming_assets_pct"]},
      {key:"funding_cost",label:"Funding-cost structure",fields:["funding_cost_pct","cost_of_funds_pct"]},
      {key:"portfolio_yield",label:"Portfolio / receivables yield",fields:["portfolio_yield_pct","receivables_yield_pct"]},
      {key:"concentration",label:"Funding or customer concentration",fields:["funding_concentration_pct","client_concentration_pct"]},
    ],
  },
  reit:{
    reservedEvidencePct:40,
    critical:[
      {key:"reviewed_ffo_affo",label:"Reviewed FFO/AFFO",fields:["ffo_per_share","affo_per_share","ffo","affo"]},
      {key:"occupancy",label:"Occupancy",fields:["occupancy_pct"]},
      {key:"same_store_noi",label:"Same-store NOI growth",fields:["same_store_noi_growth_pct"]},
      {key:"debt_maturities",label:"Debt maturity schedule",fields:["debt_maturing_3y_pct","weighted_avg_debt_maturity_years"]},
      {key:"property_concentration",label:"Property / tenant concentration",fields:["top_tenant_concentration_pct","property_concentration_pct"]},
    ],
  },
  real_estate:{
    reservedEvidencePct:35,
    critical:[
      {key:"property_economics",label:"Property-level NOI / operating economics",fields:["noi_margin_pct","same_store_noi_growth_pct"]},
      {key:"occupancy",label:"Occupancy / utilization",fields:["occupancy_pct"]},
      {key:"debt_maturities",label:"Debt maturity schedule",fields:["debt_maturing_3y_pct","weighted_avg_debt_maturity_years"]},
      {key:"asset_values",label:"Reviewed NAV / property values",fields:["nav_per_share","appraised_asset_value"]},
      {key:"concentration",label:"Tenant / property concentration",fields:["top_tenant_concentration_pct","property_concentration_pct"]},
    ],
  },
});

export const SECTOR_EVIDENCE_DEFINITIONS=DEFINITIONS;

export function isUnknownClassification(row={},profile="general"){
  const sector=String(row.sector??"").trim().toLowerCase();
  const taxonomy=String(row.sector_taxonomy_version??"").trim();
  if(sector==="unknown"||sector==="services"||!sector)return true;
  if(profile==="general"&&!taxonomy&&String(row.industry??"").trim()==="")return true;
  return false;
}

export function assessSectorEvidence(row={},profile="general",technicalCoveragePct=0){
  const technical=clamp(n(technicalCoveragePct)??0);
  const definition=DEFINITIONS[profile]??null;
  const unknown=isUnknownClassification(row,profile);

  if(!definition){
    return{
      modelVersion:SECTOR_EVIDENCE_MODEL_VERSION,
      profile,
      sensitive:false,
      classificationKnown:!unknown,
      technicalCoveragePct:round1(technical),
      criticalEvidenceCoveragePct:null,
      evidenceCoverageCeilingPct:unknown?69:100,
      effectiveCoveragePct:unknown?round1(Math.min(technical,69)):round1(technical),
      missingCriticalEvidence:[],
      presentCriticalEvidence:[],
      candidatePromotionBlocked:unknown,
      blocker:unknown
        ?"Unknown sector classification must be repaired before Solpient 100 candidate promotion."
        :null,
    };
  }

  const present=[],missing=[];
  for(const group of definition.critical){
    (groupSatisfied(row,group)?present:missing).push({
      key:group.key,
      label:group.label,
      fields:[...group.fields],
    });
  }
  const total=definition.critical.length;
  const criticalPct=total?present.length/total*100:100;
  const ceiling=100-definition.reservedEvidencePct+
    definition.reservedEvidencePct*(criticalPct/100);
  const effective=Math.min(technical,ceiling);

  return{
    modelVersion:SECTOR_EVIDENCE_MODEL_VERSION,
    profile,
    sensitive:true,
    classificationKnown:!unknown,
    technicalCoveragePct:round1(technical),
    criticalEvidenceCoveragePct:round1(criticalPct),
    evidenceCoverageCeilingPct:round1(ceiling),
    effectiveCoveragePct:round1(effective),
    reservedEvidencePct:definition.reservedEvidencePct,
    missingCriticalEvidence:missing,
    presentCriticalEvidence:present,
    candidatePromotionBlocked:unknown,
    blocker:unknown
      ?"Unknown sector classification must be repaired before Solpient 100 candidate promotion."
      :null,
  };
}
