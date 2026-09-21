import fs from "node:fs";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { canonicalSha256 } from "../lib/integrity-hash.mjs";
import { valuationPreflight } from "../lib/research-candidate-pipeline.mjs";
import { VALUATION_METHODOLOGY_VERSION } from "../lib/valuation-engine-v3.mjs";

function arg(name,fallback=null){
  const prefix="--"+name+"=";
  const hit=process.argv.find(x=>x.startsWith(prefix));
  return hit?hit.slice(prefix.length):fallback;
}

const inputPath=arg("input");
const reviewedBy=arg("reviewed-by",process.env.GITHUB_ACTOR??null);
const note=arg("note","");
if(!inputPath)throw new Error("Provide --input=/path/to/valuation-pack.json.");
if(!reviewedBy)throw new Error("Provide --reviewed-by=<name> for reviewed V3 inputs.");

const payload=JSON.parse(fs.readFileSync(inputPath,"utf8"));
const ticker=String(payload.ticker??"").trim().toUpperCase();
if(!ticker)throw new Error("Input pack requires ticker.");
const valuationInput=payload.valuation_input??payload.valuationInput;
if(!valuationInput||typeof valuationInput!=="object")throw new Error("Input pack requires valuation_input object.");

const preflight=valuationPreflight({
  ticker,
  profile:payload.screen_profile??payload.profile??"general",
},valuationInput);
if(!preflight.complete){
  throw new Error("Valuation V3 input pack is incomplete: "+preflight.missing.join(", "));
}

const url=process.env.SUPABASE_URL;
const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!secret)throw new Error("Missing SUPABASE_URL and server secret.");
const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

const [{data:company,error:companyError},{data:screenResult,error:screenError}]=await Promise.all([
  sb.from("companies").select("id,ticker").eq("ticker",ticker).maybeSingle(),
  sb.from("universe_screen_results")
    .select("id,ticker,screen_profile,created_at")
    .eq("ticker",ticker)
    .order("created_at",{ascending:false})
    .limit(1)
    .maybeSingle(),
]);
if(companyError)throw companyError;
if(screenError)throw screenError;

const canonical={
  ticker,
  company_id:company?.id??null,
  universe_screen_result_id:screenResult?.id??null,
  valuation_methodology_version:VALUATION_METHODOLOGY_VERSION,
  industry_module:valuationInput.industryModule??preflight.industryModule,
  valuation_input:{
    ...valuationInput,
    industryModule:valuationInput.industryModule??preflight.industryModule,
  },
};
const inputHash=canonicalSha256(canonical);

const {data:existing,error:existingError}=await sb.from("candidate_valuation_input_packs")
  .select("id,input_hash,status,reviewed_at")
  .eq("ticker",ticker)
  .eq("input_hash",inputHash)
  .maybeSingle();
if(existingError)throw existingError;
if(existing){
  console.log(JSON.stringify({skipped:true,reason:"identical_input_pack",...existing},null,2));
  process.exit(0);
}

const {data,error}=await sb.from("candidate_valuation_input_packs").insert({
  ticker,
  company_id:company?.id??null,
  universe_screen_result_id:screenResult?.id??null,
  valuation_methodology_version:VALUATION_METHODOLOGY_VERSION,
  industry_module:canonical.industry_module,
  status:"reviewed",
  valuation_input:canonical.valuation_input,
  input_hash:inputHash,
  reviewed_by:reviewedBy,
  reviewed_at:new Date().toISOString(),
  review_note:note||null,
}).select("id,ticker,industry_module,input_hash,reviewed_at").single();
if(error)throw error;

console.log(JSON.stringify({
  registered:true,
  pack:data,
  preflight,
},null,2));
