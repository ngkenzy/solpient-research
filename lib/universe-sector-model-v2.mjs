export const UNIVERSE_SECTOR_MODEL_VERSION="solpient-universe-sector-model-v2";

const n=(value)=>{
  const x=Number(value);
  return Number.isFinite(x)?x:null;
};
const between=(code,min,max)=>code!=null&&code>=min&&code<=max;
const match=(text,re)=>re.test(text);

export function classifySicSector(sic,description=""){
  const code=n(sic);
  const text=String(description??"").trim().toLowerCase();

  // Health care / biopharma first because pharmaceutical SICs live inside manufacturing ranges.
  if(
    between(code,2833,2836)||
    match(text,/pharma|biotech|biolog|medicinal|pharmaceutical preparation/)
  ){
    return{
      sector:"Health Care",
      industry:"Pharmaceuticals & Biotechnology",
      screen_profile:"biopharma",
      taxonomy_version:UNIVERSE_SECTOR_MODEL_VERSION,
    };
  }
  if(
    between(code,3841,3851)||between(code,8000,8099)||
    match(text,/medical device|medical instrument|surgical|hospital|health service|diagnostic|medical laborator|dental|nursing|home health/)
  ){
    return{
      sector:"Health Care",
      industry:"Health Care Equipment & Services",
      screen_profile:"healthcare",
      taxonomy_version:UNIVERSE_SECTOR_MODEL_VERSION,
    };
  }

  // Financials are intentionally split because bank economics do not generalize to insurers/brokers.
  if(
    between(code,6020,6099)||code===6111||
    match(text,/commercial bank|national bank|state bank|savings institution|credit union/)
  ){
    return{
      sector:"Financials",
      industry:"Banks & Credit Institutions",
      screen_profile:"bank",
      taxonomy_version:UNIVERSE_SECTOR_MODEL_VERSION,
    };
  }
  if(
    between(code,6311,6411)||
    match(text,/insurance carrier|insurance agent|insurance broker|life insurance|property.*casualty|title insurance|surety/)
  ){
    return{
      sector:"Financials",
      industry:"Insurance",
      screen_profile:"insurance",
      taxonomy_version:UNIVERSE_SECTOR_MODEL_VERSION,
    };
  }
  if(
    code===6211||code===6282||between(code,6722,6726)||between(code,6732,6743)||
    match(text,/security broker|securities broker|investment advice|investment management|asset management|mutual fund|investment office/)
  ){
    return{
      sector:"Financials",
      industry:"Capital Markets & Asset Management",
      screen_profile:"asset_manager",
      taxonomy_version:UNIVERSE_SECTOR_MODEL_VERSION,
    };
  }

  // Real estate / REITs need property economics rather than generic corporate FCF rules.
  if(
    code===6798||match(text,/real estate investment trust|\breit\b/)
  ){
    return{
      sector:"Real Estate",
      industry:"Equity REITs",
      screen_profile:"reit",
      taxonomy_version:UNIVERSE_SECTOR_MODEL_VERSION,
    };
  }
  if(
    between(code,6500,6553)||
    match(text,/real estate operator|real estate developer|lessor of real property|property management/)
  ){
    return{
      sector:"Real Estate",
      industry:"Real Estate Management & Development",
      screen_profile:"real_estate",
      taxonomy_version:UNIVERSE_SECTOR_MODEL_VERSION,
    };
  }

  // Communication Services.
  if(
    between(code,4812,4899)||between(code,7812,7841)||code===7311||
    match(text,/telecommunication|telephone communication|radio broadcast|television broadcast|cable television|motion picture|advertising agenc|internet publishing/)
  ){
    return{
      sector:"Communication Services",
      industry:between(code,4812,4899)?"Telecommunication Services":"Media & Interactive Services",
      screen_profile:"communication",
      taxonomy_version:UNIVERSE_SECTOR_MODEL_VERSION,
    };
  }

  // Information Technology.
  if(
    between(code,7370,7379)||
    match(text,/prepackaged software|computer programming|software service|data processing|information retrieval|cloud computing/)
  ){
    return{
      sector:"Information Technology",
      industry:"Software & IT Services",
      screen_profile:"software",
      taxonomy_version:UNIVERSE_SECTOR_MODEL_VERSION,
    };
  }
  if(
    between(code,3570,3579)||between(code,3670,3679)||
    match(text,/semiconductor|computer hardware|electronic component|communications equipment|computer peripheral/)
  ){
    return{
      sector:"Information Technology",
      industry:"Technology Hardware & Semiconductors",
      screen_profile:"technology",
      taxonomy_version:UNIVERSE_SECTOR_MODEL_VERSION,
    };
  }

  // Consumer Staples.
  if(
    between(code,2000,2199)||between(code,5411,5499)||code===5912||
    between(code,2840,2844)||
    match(text,/food product|beverage|tobacco|grocery|food store|household product|soap|cosmetic|drug store/)
  ){
    return{
      sector:"Consumer Staples",
      industry:"Consumer Staples",
      screen_profile:"consumer_staples",
      taxonomy_version:UNIVERSE_SECTOR_MODEL_VERSION,
    };
  }

  // Consumer Discretionary.
  if(
    between(code,2300,2399)||between(code,5500,5999)||between(code,7010,7041)||
    between(code,5800,5899)||code===3711||
    match(text,/apparel|footwear|restaurant|hotel|lodging|auto dealer|retail store|home furnishing|leisure|recreation/)
  ){
    return{
      sector:"Consumer Discretionary",
      industry:"Consumer Discretionary",
      screen_profile:"consumer_discretionary",
      taxonomy_version:UNIVERSE_SECTOR_MODEL_VERSION,
    };
  }

  // Utilities.
  if(
    between(code,4911,4991)||
    match(text,/electric service|natural gas distribution|water supply|sanitary service|utility/)
  ){
    return{
      sector:"Utilities",
      industry:"Utilities",
      screen_profile:"utility",
      taxonomy_version:UNIVERSE_SECTOR_MODEL_VERSION,
    };
  }

  // Energy and Materials.
  if(
    between(code,1300,1389)||code===2911||
    match(text,/oil and gas|petroleum refining|drilling|crude petroleum|natural gas extraction/)
  ){
    return{
      sector:"Energy",
      industry:"Energy",
      screen_profile:"cyclical",
      taxonomy_version:UNIVERSE_SECTOR_MODEL_VERSION,
    };
  }
  if(
    between(code,1000,1299)||between(code,1400,1499)||between(code,2400,2699)||
    between(code,2800,2829)||between(code,2850,2899)||between(code,3200,3399)||
    match(text,/mining|metal|chemical|paper|lumber|cement|glass|packaging material/)
  ){
    return{
      sector:"Materials",
      industry:"Materials",
      screen_profile:"cyclical",
      taxonomy_version:UNIVERSE_SECTOR_MODEL_VERSION,
    };
  }

  // Industrials and professional/business services.
  if(
    between(code,3400,3569)||between(code,3580,3669)||between(code,3680,3799)||
    between(code,4000,4799)||between(code,5000,5199)||between(code,7300,7399)||
    between(code,8700,8799)||
    match(text,/industrial machinery|aerospace|defense|transportation|engineering service|management consulting|employment service|business service/)
  ){
    return{
      sector:"Industrials",
      industry:between(code,4000,4799)?"Transportation":"Industrials & Business Services",
      screen_profile:"industrial",
      taxonomy_version:UNIVERSE_SECTOR_MODEL_VERSION,
    };
  }

  if(between(code,6000,6799)){
    return{
      sector:"Financials",
      industry:"Diversified Financials",
      screen_profile:"financial_other",
      taxonomy_version:UNIVERSE_SECTOR_MODEL_VERSION,
    };
  }

  return{
    sector:"Unknown",
    industry:description||null,
    screen_profile:"general",
    taxonomy_version:UNIVERSE_SECTOR_MODEL_VERSION,
  };
}
