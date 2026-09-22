import {
  classifyIssuerSector as classifyV22,
} from "./universe-sector-model-v2-2.mjs";

export const UNIVERSE_SECTOR_MODEL_VERSION="solpient-universe-sector-model-v2.3";

const n=(value)=>{
  const x=Number(value);
  return Number.isFinite(x)?x:null;
};
const upper=(value)=>String(value??"").trim().toUpperCase();
const norm=(value)=>String(value??"").trim().toLowerCase();
const between=(code,min,max)=>code!=null&&code>=min&&code<=max;

function result(sector,industry,screenProfile,method,rule,confidence="high",extra={}){
  return{
    sector,
    industry,
    screen_profile:screenProfile,
    taxonomy_version:UNIVERSE_SECTOR_MODEL_VERSION,
    classification_method:method,
    classification_rule:rule,
    classification_confidence:confidence,
    classification_review_required:false,
    classification_review_reason:null,
    ...extra,
  };
}

function reviewRequired({ticker,companyName,sic,sicDescription,reason}={}){
  return result(
    "Unknown",
    sicDescription||null,
    "general",
    "review_required",
    "review_required:"+upper(ticker||"unknown"),
    "low",
    {
      classification_review_required:true,
      classification_review_reason:reason||"Business mix or source data is insufficient for a defensible automated sector assignment.",
      classification_rationale:reason||null,
      unresolved_ticker:upper(ticker)||null,
      unresolved_company_name:companyName??null,
      unresolved_sic:sic??null,
    }
  );
}

// Reviewed issuer overrides are reserved for cases where SEC SIC is stale,
// too broad, or economically misleading for the current issuer.
export const ISSUER_SECTOR_OVERRIDES_V23=Object.freeze({
  UHAL:Object.freeze({
    sector:"Industrials",
    industry:"Ground Transportation & Equipment Rental",
    screen_profile:"industrial",
    rationale:"U-Haul's operating economics are dominated by moving equipment rental, storage, and related transportation services rather than generic auto leasing.",
  }),
  UNF:Object.freeze({
    sector:"Industrials",
    industry:"Commercial Services & Supplies",
    screen_profile:"industrial",
    rationale:"UniFirst primarily supplies and services uniform, workwear, facility-service, first-aid, and safety programs for businesses.",
  }),
  VFF:Object.freeze({
    sector:"Consumer Staples",
    industry:"Agricultural & Plant-Based Consumer Products",
    screen_profile:"consumer_staples",
    rationale:"Village Farms is a vertically integrated controlled-environment agriculture and plant-based consumer-products operator.",
  }),
  VLTO:Object.freeze({
    sector:"Industrials",
    industry:"Environmental & Water Technology",
    screen_profile:"industrial",
    rationale:"Veralto is a water and product-quality technology company; its SEC instrument SIC understates the operating business.",
  }),
  VNT:Object.freeze({
    sector:"Industrials",
    industry:"Industrial Technology",
    screen_profile:"industrial",
    rationale:"Vontier describes itself as an industrial technology company serving the connected mobility ecosystem.",
  }),
  VTSI:Object.freeze({
    sector:"Industrials",
    industry:"Aerospace, Defense & Training Systems",
    screen_profile:"industrial",
    rationale:"VirTra provides simulation and training systems, making miscellaneous manufacturing too coarse for screening.",
  }),
  VVV:Object.freeze({
    sector:"Consumer Discretionary",
    industry:"Automotive Services",
    screen_profile:"consumer_discretionary",
    rationale:"Valvoline is now primarily a retail automotive preventive-maintenance and quick-lube service operator, so petroleum-products SIC is stale for current economics.",
  }),
  WAT:Object.freeze({
    sector:"Health Care",
    industry:"Life Sciences Tools & Diagnostics",
    screen_profile:"healthcare",
    rationale:"Waters is a life-sciences and diagnostics company built around analytical instruments, informatics, consumables, and service.",
  }),
  WBTN:Object.freeze({
    sector:"Communication Services",
    industry:"Interactive Media & Entertainment",
    screen_profile:"communication",
    rationale:"WEBTOON operates global digital storytelling, webcomic, webnovel, advertising, and IP platforms rather than a traditional print publisher.",
  }),
  WHF:Object.freeze({
    sector:"Financials",
    industry:"Business Development Companies",
    screen_profile:"financial_other",
    rationale:"WhiteHorse Finance is a publicly traded business development company originating senior secured loans to lower-middle-market companies.",
  }),
  WMS:Object.freeze({
    sector:"Industrials",
    industry:"Building Products",
    screen_profile:"industrial",
    rationale:"Advanced Drainage Systems is a building/infrastructure products company; plastics-product SIC is too coarse for its operating economics.",
  }),
  WMT:Object.freeze({
    sector:"Consumer Staples",
    industry:"Consumer Staples Distribution & Retail",
    screen_profile:"consumer_staples",
    rationale:"Walmart is a broadline essential-goods retailer and should not remain Unknown because SEC variety-store SIC is coarse.",
  }),
  YETI:Object.freeze({
    sector:"Consumer Discretionary",
    industry:"Leisure Products",
    screen_profile:"consumer_discretionary",
    rationale:"YETI designs, markets, and distributes outdoor consumer products including coolers, drinkware, bags, and equipment.",
  }),
});

export const ISSUER_REVIEW_QUEUE_V23=Object.freeze({
  VAI:"Senmiao combines mobility, leasing/finance, and ride-hailing activities; current economics are not cleanly represented by SIC 7510.",
  WW:"WW International spans consumer subscription, weight-management, and clinical/telehealth offerings; current sector treatment requires reviewed business-mix evidence.",
  XWEL:"XWELL announced divestiture of legacy spa/testing businesses and a strategic pivot toward national security, so historical SIC is not decision-useful until the transition closes.",
});

function issuerOverride(args={}){
  const row=ISSUER_SECTOR_OVERRIDES_V23[upper(args.ticker)];
  if(!row)return null;
  return result(
    row.sector,
    row.industry,
    row.screen_profile,
    "issuer_override",
    "ticker:"+upper(args.ticker),
    "reviewed",
    {classification_rationale:row.rationale}
  );
}

function queuedReview(args={}){
  const reason=ISSUER_REVIEW_QUEUE_V23[upper(args.ticker)];
  return reason?reviewRequired({...args,reason}):null;
}

function safeSicCoverage(args={}){
  const sic=args.sic;
  const description=args.sicDescription??"";
  const code=n(sic);
  const text=norm(description);

  if(between(code,100,999)){
    return result("Consumer Staples","Agricultural Products","consumer_staples","sic_family_rule","sic:0100-0999","high");
  }
  if(between(code,1500,1799)){
    return result("Industrials","Construction & Engineering","industrial","sic_family_rule","sic:1500-1799","high");
  }
  if(between(code,2200,2399)){
    return result("Consumer Discretionary","Textiles, Apparel & Luxury Goods","consumer_discretionary","sic_family_rule","sic:2200-2399","high");
  }
  if(between(code,2700,2749)){
    return result("Communication Services","Publishing & Digital Media","communication","sic_family_rule","sic:2700-2749","high");
  }
  if(between(code,2900,2999)){
    return result("Energy","Petroleum Products","cyclical","sic_family_rule","sic:2900-2999","high");
  }
  if(between(code,3000,3099)){
    return result("Materials","Rubber & Plastic Products","cyclical","sic_family_rule","sic:3000-3099","high");
  }
  if(between(code,3100,3199)){
    return result("Consumer Discretionary","Leather Goods & Accessories","consumer_discretionary","sic_family_rule","sic:3100-3199","high");
  }
  if(code===3826||/laboratory analytical instruments?/.test(text)){
    return result("Health Care","Life Sciences Tools & Diagnostics","healthcare","description_rule","description:laboratory_analytical_instruments","high");
  }
  if(code===3824||code===3825||/fluid meters?|meas(urement)? & testing|measuring & testing|electrical signals?/.test(text)){
    return result("Industrials","Industrial Measurement & Instrumentation","industrial","description_rule","description:industrial_instrumentation","medium");
  }
  if(between(code,3940,3949)){
    return result("Consumer Discretionary","Leisure & Sporting Goods","consumer_discretionary","sic_family_rule","sic:3940-3949","high");
  }
  if(code===5331||/retail-variety stores?|variety stores?/.test(text)){
    return result("Consumer Staples","Consumer Staples Distribution & Retail","consumer_staples","description_rule","description:variety_retail","medium");
  }

  // These SICs are too broad to classify safely without issuer/business context.
  if(code===7200){
    return reviewRequired({
      ...args,
      reason:"SIC 7200 Personal Services spans materially different business models and requires issuer-level review."
    });
  }
  if(code===7510){
    return reviewRequired({
      ...args,
      reason:"SIC 7510 Auto Rental & Leasing spans rental, mobility, and financing models and requires issuer-level review."
    });
  }
  if(code===3990){
    return reviewRequired({
      ...args,
      reason:"SIC 3990 Miscellaneous Manufacturing is too broad for a defensible sector assignment without issuer-level evidence."
    });
  }
  return null;
}

export function classifyIssuerSector(args={}){
  const reviewed=issuerOverride(args);
  if(reviewed)return reviewed;

  const review=queuedReview(args);
  if(review)return review;

  const v22=classifyV22(args);
  if(v22.sector!=="Unknown"&&v22.classification_method!=="unresolved"){
    return{
      ...v22,
      taxonomy_version:UNIVERSE_SECTOR_MODEL_VERSION,
      classification_review_required:false,
      classification_review_reason:null,
    };
  }

  const coverage=safeSicCoverage(args);
  if(coverage){
    if(coverage.classification_review_required){
      return{
        ...coverage,
        taxonomy_version:UNIVERSE_SECTOR_MODEL_VERSION,
        unresolved_ticker:upper(args.ticker)||(coverage.unresolved_ticker??null),
        unresolved_company_name:args.companyName??coverage.unresolved_company_name??null,
      };
    }
    return coverage;
  }

  const missingSic=args.sic===null||args.sic===undefined||String(args.sic).trim()==="";
  return reviewRequired({
    ...args,
    reason:missingSic
      ?"Insufficient classification data: no usable SIC and no reviewed issuer override/provider classification."
      :"No defensible V2.3 SIC, description, provider, or issuer rule currently resolves this operating business."
  });
}

// Compatibility helper for callers that only have SIC metadata.
export function classifySicSector(sic,description=""){
  return classifyIssuerSector({sic,sicDescription:description});
}
