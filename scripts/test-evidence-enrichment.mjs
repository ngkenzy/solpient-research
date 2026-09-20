import assert from"node:assert/strict";import{buildEnrichmentReviewPatch,mergeReviewPatches,validateEnrichmentPack}from"../lib/evidence-enrichment.mjs";
const pack={ticker:"MSFT",run_key:"x",allowed_domains:["sec.gov"],sources:[{key:"s",title:"10-K",url:"https://www.sec.gov/x",source_type:"10-K",primary:true}],items:[{item_key:"d",item_type:"metric",module:"universal",metric_key:"total_debt",label:"Debt",value_numeric:40,basis:"reported",confidence:"high",source_key:"s",fact_text:"Debt 40."}]};
assert.equal(validateEnrichmentPack(pack).valid,true);const bad=structuredClone(pack);bad.sources[0].url="https://evil.test/x";assert.equal(validateEnrichmentPack(bad).valid,false);
const rows=[{...pack.items[0],source_title:"10-K",source_url:"https://www.sec.gov/x",source_type:"10-K",source_date:"2026-06-30",status:"proposed",metadata:{}}];
const patch=buildEnrichmentReviewPatch(rows);assert.equal(patch.metric_observations[0].value_numeric,40);
const merged=mergeReviewPatches({business_assessment:{moat_rating:"wide"},metric_observations:[{module:"universal",metric_key:"total_debt",status:"not_available"}]},patch);
assert.equal(merged.business_assessment.moat_rating,"wide");assert.equal(merged.metric_observations[0].value_numeric,40);console.log("Evidence Enrichment v1 tests passed.");
