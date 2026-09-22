import { classifySicSector as classifyBaseV2 } from "./universe-sector-model-v2.mjs";

export const UNIVERSE_SECTOR_MODEL_VERSION="solpient-universe-sector-model-v2.2";

const n=(value)=>{
  const x=Number(value);
  return Number.isFinite(x)?x:null;
};
const norm=(value)=>String(value??"").trim().toLowerCase();
const upper=(value)=>String(value??"").trim().toUpperCase();
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
    ...extra,
  };
}

// Reviewed issuer-level exceptions are intentionally narrow.
// They are used where SEC SIC is too coarse or economically misleading for the modern issuer.
export const ISSUER_SECTOR_OVERRIDES=Object.freeze({
  AWI:Object.freeze({
    sector:"Industrials",
    industry:"Building Products",
    screen_profile:"industrial",
    rationale:"SEC SIC 3089 is too coarse for Armstrong World Industries; issuer economics are building products.",
  }),
  LOPE:Object.freeze({
    sector:"Consumer Discretionary",
    industry:"Education Services",
    screen_profile:"consumer_discretionary",
    rationale:"Grand Canyon Education is an education-services operating company.",
  }),
  YELP:Object.freeze({
    sector:"Communication Services",
    industry:"Interactive Media & Services",
    screen_profile:"communication",
    rationale:"SEC SIC 7200 does not describe Yelp's interactive-media/local-discovery economics.",
  }),
});

function issuerOverride({ticker,companyName,cik}={}){
  const byTicker=ISSUER_SECTOR_OVERRIDES[upper(ticker)];
  if(byTicker){
    return result(
      byTicker.sector,
      byTicker.industry,
      byTicker.screen_profile,
      "issuer_override",
      "ticker:"+upper(ticker),
      "reviewed",
      {classification_rationale:byTicker.rationale}
    );
  }

  // Hooks for future stable identifiers without requiring a schema change.
  const company=norm(companyName);
  if(company==="armstrong world industries inc"||company==="armstrong world industries, inc."){
    const row=ISSUER_SECTOR_OVERRIDES.AWI;
    return result(row.sector,row.industry,row.screen_profile,"issuer_override","company_name:armstrong_world_industries","reviewed",{classification_rationale:row.rationale});
  }
  if(company.includes("grand canyon education")){
    const row=ISSUER_SECTOR_OVERRIDES.LOPE;
    return result(row.sector,row.industry,row.screen_profile,"issuer_override","company_name:grand_canyon_education","reviewed",{classification_rationale:row.rationale});
  }
  if(company==="yelp inc"||company==="yelp inc."){
    const row=ISSUER_SECTOR_OVERRIDES.YELP;
    return result(row.sector,row.industry,row.screen_profile,"issuer_override","company_name:yelp","reviewed",{classification_rationale:row.rationale});
  }

  void cik;
  return null;
}

function specificSicRepair(sic){
  const code=n(sic);
  if(between(code,8200,8299)){
    return result(
      "Consumer Discretionary",
      "Education Services",
      "consumer_discretionary",
      "sic_rule",
      "sic:8200-8299",
      "high"
    );
  }
  return null;
}

function descriptionRepair(description=""){
  const text=norm(description);
  if(!text)return null;

  if(/educational services?|schools?|colleges?|universit/.test(text)){
    return result(
      "Consumer Discretionary",
      "Education Services",
      "consumer_discretionary",
      "description_rule",
      "description:education_services",
      "medium"
    );
  }
  if(/interactive media|online reviews?|local discovery|internet content|digital advertising/.test(text)){
    return result(
      "Communication Services",
      "Interactive Media & Services",
      "communication",
      "description_rule",
      "description:interactive_media",
      "medium"
    );
  }
  if(/building products?|ceiling systems?|wall systems?|architectural products?/.test(text)){
    return result(
      "Industrials",
      "Building Products",
      "industrial",
      "description_rule",
      "description:building_products",
      "medium"
    );
  }
  return null;
}

export function classifyIssuerSector({
  ticker=null,
  cik=null,
  companyName=null,
  sic=null,
  sicDescription="",
  existingSector=null,
  existingIndustry=null,
  existingScreenProfile=null,
}={}){
  const override=issuerOverride({ticker,cik,companyName});
  if(override)return override;

  const sicRepair=specificSicRepair(sic);
  if(sicRepair)return sicRepair;

  const description=descriptionRepair(sicDescription);
  if(description)return description;

  const base=classifyBaseV2(sic,sicDescription);
  if(base.sector!=="Unknown"){
    return{
      ...base,
      taxonomy_version:UNIVERSE_SECTOR_MODEL_VERSION,
      classification_method:"base_v2",
      classification_rule:"sector_model_v2",
      classification_confidence:"high",
    };
  }

  const existing=String(existingSector??"").trim();
  if(existing&&![ "unknown","services" ].includes(existing.toLowerCase())){
    return result(
      existing,
      existingIndustry??null,
      existingScreenProfile??"general",
      "provider_existing",
      "provider_existing_classification",
      "medium"
    );
  }

  return result(
    "Unknown",
    sicDescription||null,
    "general",
    "unresolved",
    "unresolved",
    "low",
    {
      unresolved_ticker:upper(ticker)||null,
      unresolved_cik:cik?String(cik):null,
    }
  );
}

// Compatibility helper for callers that only have SIC metadata.
// Issuer overrides require classifyIssuerSector().
export function classifySicSector(sic,description=""){
  return classifyIssuerSector({sic,sicDescription:description});
}
