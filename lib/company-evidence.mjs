export const COMPANY_EVIDENCE_VERSION="company-evidence-v1";

const PFE_SOURCES={
  q2:"https://www.sec.gov/Archives/edgar/data/78003/000007800326000094/pfe-6282026xex99.htm",
  tenq:"https://www.sec.gov/Archives/edgar/data/78003/000007800326000095/pfe-20260628.htm",
  tenk:"https://www.sec.gov/Archives/edgar/data/78003/000007800326000026/pfe-20251231.htm",
  annual:"https://annualreview.pfizer.com/",
  pipeline:"https://www.pfizer.com/science/drug-product-pipeline",
  dividend:"https://www.pfizer.com/news/press-release/press-release-detail/pfizer-declares-third-quarter-2026-dividend",
};

function metric(metric_key,label,{value_numeric=null,value_text=null,unit=null,basis="reported",source_title,source_url,notes=null}){
  return{
    module:"biopharma",metric_key,label,status:"available",basis,value_numeric,value_text,unit,
    period_end:"2026-08-04",period_type:"company_guidance",source_title,source_url,
    calculation_method:null,notes,
  };
}

export function companyEvidenceForTicker(ticker){
  if(String(ticker).toUpperCase()!=="PFE")return{version:COMPANY_EVIDENCE_VERSION,metricObservations:[],sources:[],businessAssessment:{}};
  return{
    version:COMPANY_EVIDENCE_VERSION,
    metricObservations:[
      metric("adjusted_eps_guidance_midpoint","2026 adjusted EPS guidance midpoint",{
        value_numeric:2.90,unit:"USD/share",basis:"estimate",
        source_title:"Pfizer Q2 2026 earnings release",source_url:PFE_SOURCES.q2,
        notes:"Full-year 2026 adjusted diluted EPS guidance is $2.80-$3.00; midpoint stored for normalized earnings context."
      }),
      metric("revenue_guidance_midpoint","2026 revenue guidance midpoint",{
        value_numeric:61.5e9,unit:"USD",basis:"estimate",
        source_title:"Pfizer Q2 2026 earnings release",source_url:PFE_SOURCES.q2,
        notes:"Full-year 2026 revenue guidance is $60.5-$62.5 billion."
      }),
      metric("top_product_revenue_concentration","Top product revenue concentration",{
        value_numeric:13,unit:"percent",basis:"reported",
        value_text:"Eliquis represented 13% of Pfizer 2025 total revenue.",
        source_title:"Pfizer 2025 Annual Review",source_url:PFE_SOURCES.annual
      }),
      metric("top_10_product_revenue_concentration","Top 10 product revenue concentration",{
        value_numeric:61,unit:"percent",basis:"reported",
        value_text:"Pfizer's top 10 medicines and vaccines represented 61% of 2025 total revenue.",
        source_title:"Pfizer 2025 Annual Review",source_url:PFE_SOURCES.annual
      }),
      metric("patent_expiry_revenue_exposure","2026 loss-of-exclusivity revenue impact",{
        value_numeric:1.1e9,unit:"USD",basis:"estimate",
        value_text:"Pfizer expects approximately $1.1 billion of unfavorable 2026 revenue impact from patent/regulatory exclusivity expiries and says the impact will accelerate through 2030.",
        source_title:"Pfizer Q2 2026 Form 10-Q",source_url:PFE_SOURCES.tenq
      }),
      metric("pipeline_revenue_replacement","Pipeline replacement evidence",{
        value_numeric:33,unit:"late-stage/registration programs",basis:"reported",
        value_text:"95 total pipeline programs as of Aug. 4, 2026: 37 Phase 1, 25 Phase 2, 31 Phase 3 and 2 Registration. The 33 Phase 3/registration programs indicate replacement capacity but are not a probability-adjusted revenue forecast.",
        source_title:"Pfizer product pipeline",source_url:PFE_SOURCES.pipeline,
        notes:"Use as pipeline-capacity evidence only; do not convert directly into forecast revenue without asset-level probabilities and market assumptions."
      }),
      metric("launched_acquired_products_growth","Launched/acquired product operational growth",{
        value_numeric:18,unit:"percent",basis:"reported",
        source_title:"Pfizer Q2 2026 earnings release",source_url:PFE_SOURCES.q2,
        notes:"Second-quarter 2026 operational revenue growth for launched and acquired products."
      }),
      metric("ex_covid_operational_growth","Revenue growth excluding COVID products",{
        value_numeric:5,unit:"percent",basis:"reported",
        source_title:"Pfizer Q2 2026 earnings release",source_url:PFE_SOURCES.q2,
        notes:"Second-quarter 2026 operational revenue growth excluding Comirnaty and Paxlovid."
      }),
      metric("annualized_dividend_per_share","Annualized dividend per share",{
        value_numeric:1.72,unit:"USD/share",basis:"reported",
        source_title:"Pfizer Q3 2026 dividend declaration",source_url:PFE_SOURCES.dividend,
        notes:"Annualized from the $0.43 quarterly dividend; not a guarantee of future dividends."
      }),
    ],
    sources:[
      {source_type:"8-K Exhibit 99",title:"Pfizer Q2 2026 earnings release",url:PFE_SOURCES.q2,filing_date:"2026-08-04",accession_number:"0000078003-26-000094"},
      {source_type:"10-Q",title:"Pfizer Q2 2026 Form 10-Q",url:PFE_SOURCES.tenq,filing_date:"2026-08-04",accession_number:"0000078003-26-000095"},
      {source_type:"10-K",title:"Pfizer 2025 Form 10-K",url:PFE_SOURCES.tenk,filing_date:"2026-02-26",accession_number:"0000078003-26-000026"},
      {source_type:"Company annual review",title:"Pfizer 2025 Annual Review",url:PFE_SOURCES.annual,filing_date:null,accession_number:null},
      {source_type:"Company pipeline",title:"Pfizer pipeline as of August 4, 2026",url:PFE_SOURCES.pipeline,filing_date:"2026-08-04",accession_number:null},
      {source_type:"Company release",title:"Pfizer Q3 2026 dividend declaration",url:PFE_SOURCES.dividend,filing_date:"2026-06-24",accession_number:null},
    ],
    businessAssessment:{
      customer_concentration:"No single customer concentration conclusion is made from the current evidence; product concentration is more material for Pfizer.",
      market_position:"Large global biopharma portfolio with material exposure to mature blockbusters, an expanding oncology franchise and a broad clinical pipeline.",
      growth_runway:"Near-term growth depends on launched/acquired products and pipeline conversion offsetting COVID normalization and accelerating 2026-2030 loss-of-exclusivity pressure.",
      cyclicality:"Demand is less economically cyclical than many industries, but product revenue is highly exposed to patent cycles, reimbursement, clinical outcomes and regulatory events.",
      capital_intensity:"R&D-intensive rather than fixed-asset-intensive; capital allocation must be judged across internal R&D, licensing/M&A, debt reduction and the dividend.",
      capital_allocation_assessment:"Assess the Seagen/other business-development returns, debt reduction and dividend coverage against the value of pipeline replenishment.",
      bull_thesis:"Launched and acquired products sustain growth, late-stage pipeline conversion replenishes revenue lost to exclusivity expiries, oncology execution improves portfolio quality, and normalized earnings support the dividend while debt declines.",
      bear_thesis:"The 2026-2030 patent cliff outpaces pipeline replacement, acquired assets fail to earn adequate returns, pricing pressure compresses economics, and dividend/debt commitments constrain reinvestment.",
      capital_allocation_test:"Active ownership requires normalized earnings plus dividends and pipeline replacement economics to offer a superior risk-adjusted return to the broad market after accounting for patent-cliff and clinical-development risk.",
      biggest_unknown:"Whether the late-stage pipeline and acquired oncology assets can replace enough revenue and earnings before the 2026-2030 loss-of-exclusivity wave peaks."
    }
  };
}
