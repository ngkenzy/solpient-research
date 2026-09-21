import { INDUSTRY_MODULES } from "./industry-modules.mjs";
export const SOLPIENT_STANDARD_VERSION_V2="solpient-v2";
export const V2_CORE_METRIC_KEYS=["revenue_growth_1y","gross_margin","operating_margin","net_margin","operating_cash_flow","free_cash_flow","fcf_margin","fcf_per_share","fcf_conversion","cash","total_debt","net_debt","shares_outstanding","forward_pe","price_to_fcf","fcf_yield"];
export const V2_REQUIRED_SECTIONS=["investment_thesis","business_assessment","financial_quality","fundamental_scorecard","competitive_position","valuation_analysis","historical_valuation","expected_return_scenarios","risk_register","investment_lenses","decision_dashboard","final_conclusion","thesis_variables","sources"];
function hasValue(v){return v!==null&&v!==undefined&&v!=="";}
function hasText(v){return typeof v==="string"&&v.trim().length>0;}
function sectionPresent(payload,key){const value=payload?.[key];if(Array.isArray(value))return value.length>0;return Boolean(value&&typeof value==="object"&&Object.keys(value).length);}
function consideredMethod(methods,id){return methods.some(m=>m?.method===id&&["applied","not_applicable","unavailable"].includes(m?.status)&&hasText(m?.reason));}
function conclusionComplete(c){return ["great_business","valuation","realistic_return","impairment_risks","index_case"].every(k=>hasText(c?.[k]));}
function dashboardComplete(d){const keys=["current_price","market_cap","enterprise_value","business_quality","moat","financial_strength","growth_outlook","valuation","risk_level","bear_case_fair_value","base_case_fair_value","bull_case_fair_value","mos_25_price","mos_35_price","expected_5y_base_cagr","expected_10y_base_cagr","most_important_bull_argument","most_important_bear_argument","biggest_unknown","thesis_breaker","capital_allocation_test","classification"];return keys.every(k=>Object.prototype.hasOwnProperty.call(d??{},k)&&hasValue(d[k]));}
export function validateResearchStandardV2(payload){
 const notes=[],research=payload?.research??{};
 if(research.standard_version!==SOLPIENT_STANDARD_VERSION_V2)return{applies:false,valid:true,status:"legacy",completenessPct:null,metricCoveragePct:null,industryModuleCoveragePct:null,notes:[]};
 const missingSections=V2_REQUIRED_SECTIONS.filter(k=>!sectionPresent(payload,k));if(missingSections.length)notes.push("Missing v2 sections: "+missingSections.join(", ")+".");
 if(!hasValue(research.data_cutoff_at))notes.push("research.data_cutoff_at is missing.");if(!hasValue(research.benchmark_ticker))notes.push("research.benchmark_ticker is missing.");
 const observations=Array.isArray(payload.metric_observations)?payload.metric_observations:[];
 const byKey=new Map(observations.filter(r=>(r.module??"universal")==="universal").map(r=>[r.metric_key,r]));
 const missingCore=V2_CORE_METRIC_KEYS.filter(k=>!byKey.has(k));
 const coveredCore=V2_CORE_METRIC_KEYS.filter(k=>{const row=byKey.get(k);return row&&["available","not_applicable"].includes(row.status);}).length;
 if(missingCore.length)notes.push("Missing core metric records: "+missingCore.join(", ")+".");
 const invalidMetrics=observations.filter(row=>!row?.metric_key||!row?.label||!["available","not_available","not_applicable"].includes(row.status??"available")||!["reported","derived","estimate","assumption","assessment"].includes(row.basis??"reported")||((row.status??"available")==="available"&&!hasValue(row.value_numeric)&&!hasValue(row.value_text)));if(invalidMetrics.length)notes.push("One or more metric observations are invalid.");
 const modules=Array.isArray(research.industry_modules)?research.industry_modules:[];let industryRequired=0,industryCovered=0;const industryMissing=[],decisionGradeChecks=[],decisionGradeBlockers=[];
 for(const module of modules){
   const def=INDUSTRY_MODULES[module];
   if(!def){industryMissing.push(module+":unknown");continue;}
   for(const key of def.requiredMetricKeys){
     industryRequired++;
     const row=observations.find(r=>r.module===module&&r.metric_key===key);
     if(!row)industryMissing.push(module+":"+key);
     else if(["available","not_applicable"].includes(row.status))industryCovered++;
   }
   for(const key of def.criticalMetricKeys??[]){
     const row=observations.find(r=>r.module===module&&r.metric_key===key);
     const passed=Boolean(row&&row.status==="available"&&(hasValue(row.value_numeric)||hasValue(row.value_text)));
     decisionGradeChecks.push(passed);
     if(!passed)decisionGradeBlockers.push("Critical "+module+" evidence is unavailable: "+key+".");
   }
   if(Number(def.minPeerDataCount??0)>0){
     const peerCount=Number(payload?.competitive_position?.peer_data_count??0);
     const passed=peerCount>=Number(def.minPeerDataCount);
     decisionGradeChecks.push(passed);
     if(!passed)decisionGradeBlockers.push("Decision-grade "+module+" research requires at least "+def.minPeerDataCount+" peers with normalized local data; currently "+peerCount+".");
   }
   if(def.requireThreeYearValuationHistory){
     const h3=payload?.historical_valuation?.["3y"];
     const passed=Boolean(h3?.status==="available"&&Number(h3?.coverage_years??0)>=2.4);
     decisionGradeChecks.push(passed);
     if(!passed)decisionGradeBlockers.push("Decision-grade "+module+" research requires roughly three years of point-in-time valuation history.");
   }
 }
 if(industryMissing.length)notes.push("Missing industry-module metric records: "+industryMissing.join(", ")+".");
 const business=payload.business_assessment??{};for(const key of ["business_quality_rating","moat_rating","bull_thesis","bear_thesis","capital_allocation_test","biggest_unknown"])if(!hasValue(business[key]))notes.push("business_assessment."+key+" is missing.");
 const financial=payload.financial_quality??{};if(!(Number(financial.history_years)>=5||hasText(financial.history_limitation)))notes.push("Financial history must cover five years where available or explain the limitation.");if(!Array.isArray(financial.improving_trends)||!Array.isArray(financial.deteriorating_trends))notes.push("Financial-quality trend analysis is incomplete.");
 const scorecard=Array.isArray(payload.fundamental_scorecard)?payload.fundamental_scorecard:[];if(scorecard.length<8)notes.push("Fundamental scorecard needs at least eight material metrics.");if(scorecard.some(r=>!hasText(r?.metric)||!hasText(r?.assessment)))notes.push("Scorecard rows need metric and assessment.");
 const comp=payload.competitive_position??{};if(!(Array.isArray(comp.peers)&&comp.peers.length>=2)&&!hasText(comp.peer_limitation))notes.push("Competitive position needs at least two relevant peers or a peer limitation.");
 const valuation=payload.valuation_analysis??{},methods=Array.isArray(valuation.methods)?valuation.methods:[];for(const method of ["dcf","owner_earnings","earnings_or_fcf_multiple","historical_valuation","peer_valuation"])if(!consideredMethod(methods,method))notes.push("Valuation method not explicitly considered: "+method+".");
 const assumptions=valuation.assumptions??{};for(const key of ["revenue_growth","operating_margin","tax_rate","reinvestment","fcf_growth","discount_rate","terminal_assumption","future_share_dilution"])if(!hasValue(assumptions[key]))notes.push("Valuation assumption missing: "+key+".");
 const values=payload.valuations??{};for(const key of ["bear_value","base_value","bull_value","mos_25_price","mos_35_price"])if(!hasValue(values[key]))notes.push("Reviewed valuation missing: "+key+".");
 const hist=payload.historical_valuation??{};for(const horizon of ["3y","5y","10y"]){const row=hist[horizon];if(!row||!["available","not_meaningful","unavailable"].includes(row.status)||!hasText(row.explanation))notes.push("Historical valuation context incomplete for "+horizon+".");}
 const expected=Array.isArray(payload.expected_return_scenarios)?payload.expected_return_scenarios:[],scenarios=new Set(expected.map(r=>r.scenario+":"+r.horizon_years));for(const h of [3,5,10])for(const s of ["bear","base","bull"])if(!scenarios.has(s+":"+h))notes.push("Missing expected-return scenario "+s+" for "+h+" years.");if(expected.some(r=>!hasValue(r?.expected_cagr)||!r?.return_decomposition||typeof r.return_decomposition!=="object")&&expected.length)notes.push("Expected-return scenarios need CAGR and return decomposition.");
 const risks=Array.isArray(payload.risk_register)?payload.risk_register:[];if(risks.length<3)notes.push("At least three material risks are required.");if(risks.some(r=>!hasText(r?.probability)||!hasText(r?.severity)||!hasText(r?.thesis_breaker)))notes.push("Each major risk needs probability, severity and thesis breaker.");
 const thesis=Array.isArray(payload.thesis_variables)?payload.thesis_variables:[];if(thesis.length<3||thesis.filter(r=>hasText(r?.breaker_condition)).length<3)notes.push("At least three monitored thesis conditions need explicit breaker conditions.");
 const lenses=payload.investment_lenses??{};if(!hasText(lenses?.buffett?.business_quality_fit)||!hasText(lenses?.buffett?.valuation_fit)||!hasText(lenses?.buffett?.conclusion))notes.push("Buffett-style lens is incomplete.");if(!hasText(lenses?.lynch?.classification)||!hasText(lenses?.lynch?.growth_fit)||!hasText(lenses?.lynch?.valuation_fit)||!hasText(lenses?.lynch?.conclusion))notes.push("Lynch-style lens is incomplete.");
 if(!dashboardComplete(payload.decision_dashboard))notes.push("Decision dashboard is incomplete.");if(!conclusionComplete(payload.final_conclusion))notes.push("Five-part final conclusion is incomplete.");
 const metricCoveragePct=V2_CORE_METRIC_KEYS.length?coveredCore/V2_CORE_METRIC_KEYS.length*100:100,industryCoveragePct=industryRequired?industryCovered/industryRequired*100:100;
 const industryRecordCoveragePct=industryRequired?(industryRequired-industryMissing.length)/industryRequired*100:100;
 const structuralChecks=[missingSections.length===0,hasValue(research.data_cutoff_at),hasValue(research.benchmark_ticker),scorecard.length>=8,risks.length>=3,expected.length>=9,thesis.length>=3,methods.length>=5,dashboardComplete(payload.decision_dashboard),conclusionComplete(payload.final_conclusion),invalidMetrics.length===0,missingCore.length===0,industryMissing.length===0];
 const structuralPct=structuralChecks.filter(Boolean).length/structuralChecks.length*100,completenessPct=Math.round((structuralPct*.55+metricCoveragePct*.25+industryCoveragePct*.20)*10)/10,valid=notes.length===0;
 const complete=valid&&metricCoveragePct>=80&&industryRecordCoveragePct===100;
 const decisionGradeReady=decisionGradeBlockers.length===0;
 const decisionGradeCoveragePct=decisionGradeChecks.length?Math.round((decisionGradeChecks.filter(Boolean).length/decisionGradeChecks.length)*1000)/10:100;
 return{applies:true,valid,status:complete?"complete":"partial",completenessPct,metricCoveragePct:Math.round(metricCoveragePct*10)/10,industryModuleCoveragePct:Math.round(industryCoveragePct*10)/10,industryModuleRecordCoveragePct:Math.round(industryRecordCoveragePct*10)/10,requiredMetricRecordsPresent:V2_CORE_METRIC_KEYS.length-missingCore.length,decisionGradeReady,decisionGradeCoveragePct,decisionGradeBlockers,notes};
}
