import { buildResearchChanges } from "./research-changes.mjs";
import { validatePromotionReadiness, materializeFinancialMetrics } from "./review-workbench.mjs";
import { canonicalSha256, CANONICALIZATION_VERSION } from "./integrity-hash.mjs";
import { buildResearchInputManifest, stageResearchInputManifest } from "./evidence-provenance-db.mjs";

function cleanRow(value) {
  if (!value || typeof value !== "object") return value;
  const row = { ...value };
  delete row.id;
  delete row.research_run_id;
  delete row.created_at;
  return row;
}


function slug(value) {
  return String(value ?? "risk")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,"_")
    .replace(/^_+|_+$/g,"")
    .slice(0,80) || "risk";
}

function normalizeBusinessAssessment(value) {
  if (!value || typeof value!=="object") return value;
  const allowed=[
    "business_quality_rating","moat_rating","pricing_power","revenue_model",
    "recurring_revenue_pct","customer_concentration","geographic_exposure",
    "market_position","growth_runway","cyclicality","capital_intensity",
    "ai_opportunity","ai_threat","management_quality",
    "capital_allocation_assessment","bull_thesis","bear_thesis",
    "capital_allocation_test","biggest_unknown","evidence",
  ];
  const row={};
  for (const key of allowed) if (Object.prototype.hasOwnProperty.call(value,key)) row[key]=value[key];
  if (!Array.isArray(row.evidence)) row.evidence=[];
  return row;
}

function normalizeRiskLevel(value) {
  const level=String(value ?? "").toLowerCase();
  if (level==="low") return "low";
  if (["high","elevated","severe"].includes(level)) return "high";
  return "medium";
}

function normalizeRiskRows(values=[]) {
  return values.map((value,index)=>{
    const title=value?.title ?? value?.risk ?? ("Risk "+(index+1));
    return {
      risk_key:value?.risk_key ?? slug(title),
      category:value?.category ?? "investment",
      title,
      description:value?.description ?? null,
      probability:normalizeRiskLevel(value?.probability),
      severity:normalizeRiskLevel(value?.severity),
      leading_indicators:value?.leading_indicators ?? null,
      thesis_breaker:value?.thesis_breaker ?? null,
      evidence:typeof value?.evidence==="string"?value.evidence:(value?.evidence?JSON.stringify(value.evidence):null),
      source_urls:Array.isArray(value?.source_urls)?value.source_urls:[],
    };
  });
}

function normalizeExpectedReturnRows(values=[]) {
  return values.map((value)=>({
    scenario:value?.scenario,
    horizon_years:value?.horizon_years,
    starting_fcf_yield:value?.starting_fcf_yield ?? null,
    fcf_growth_assumption:value?.fcf_growth_assumption ?? null,
    revenue_growth_assumption:value?.revenue_growth_assumption ?? null,
    margin_change_contribution:value?.margin_change_contribution ?? null,
    share_count_contribution:value?.share_count_contribution ?? null,
    dividend_contribution:value?.dividend_contribution ?? null,
    multiple_change_contribution:value?.multiple_change_contribution ?? null,
    exit_multiple:value?.exit_multiple ?? null,
    expected_cagr:value?.expected_cagr ?? null,
    estimated_terminal_value_per_share:value?.estimated_terminal_value_per_share ?? value?.terminal_value ?? null,
    methodology:value?.methodology ?? "Price-only CAGR from reviewed fair-value scenario.",
    assumptions:value?.assumptions ?? value?.return_decomposition ?? {},
  }));
}


function normalizeThesisStatus(value) {
  const status=String(value ?? "").toLowerCase();
  if (["strengthened","unchanged","weakened","unknown","monitor"].includes(status)) return status;
  return "unknown";
}

function normalizeThesisRows(values=[]) {
  return values.map((value)=>({
    variable_name:value?.variable_name,
    expectation:value?.expectation ?? null,
    observed_value:value?.observed_value ?? null,
    status:normalizeThesisStatus(value?.status),
    evidence:typeof value?.evidence==="string"?value.evidence:(value?.evidence?JSON.stringify(value.evidence):null),
    metric_key:value?.metric_key ?? null,
    comparator:value?.comparator ?? null,
    threshold_value:value?.threshold_value ?? null,
    threshold_unit:value?.threshold_unit ?? null,
    review_frequency:value?.review_frequency ?? null,
    breaker_condition:value?.breaker_condition ?? null,
  }));
}

function normalizeSourceRows(values=[],fallbackRetrievedAt=new Date().toISOString()) {
  return values.map((value)=>({
    source_type:value?.source_type ?? "Other",
    title:value?.title ?? "Source",
    url:value?.url ?? null,
    filing_date:value?.filing_date ?? null,
    accession_number:value?.accession_number ?? null,
    retrieved_at:value?.retrieved_at ?? fallbackRetrievedAt,
  }));
}

export function buildPublicationPackage(payload, promotedAt = new Date().toISOString()) {
  const publicationPayload=structuredClone(payload);
  publicationPayload.research={...(publicationPayload.research ?? {}),status:"published"};
  publicationPayload.financial_metrics={
    ...materializeFinancialMetrics(publicationPayload),
    ...(publicationPayload.financial_metrics ?? {}),
  };
  if (publicationPayload.prediction) delete publicationPayload.prediction;

  return {
    ticker:publicationPayload.ticker,
    company_name:publicationPayload.company_name,
    research:publicationPayload.research ?? {},
    financial_metrics:cleanRow(publicationPayload.financial_metrics ?? {}),
    scores:cleanRow(publicationPayload.scores ?? {}),
    valuations:cleanRow(publicationPayload.valuations ?? {}),
    business_assessment:cleanRow(normalizeBusinessAssessment(publicationPayload.business_assessment ?? {})),
    metric_observations:(publicationPayload.metric_observations ?? []).map(cleanRow),
    risk_register:normalizeRiskRows(publicationPayload.risk_register ?? []).map(cleanRow),
    expected_return_scenarios:normalizeExpectedReturnRows(publicationPayload.expected_return_scenarios ?? []).map(cleanRow),
    thesis_variables:normalizeThesisRows(publicationPayload.thesis_variables ?? []).map(cleanRow),
    sources:normalizeSourceRows(publicationPayload.sources ?? [],publicationPayload.research?.data_cutoff_at ?? promotedAt).map(cleanRow),
    investment_thesis:publicationPayload.investment_thesis ?? {},
    financial_quality:publicationPayload.financial_quality ?? {},
    fundamental_scorecard:publicationPayload.fundamental_scorecard ?? [],
    competitive_position:publicationPayload.competitive_position ?? {},
    valuation_analysis:publicationPayload.valuation_analysis ?? {},
    historical_valuation:publicationPayload.historical_valuation ?? {},
    investment_lenses:publicationPayload.investment_lenses ?? {},
    decision_dashboard:publicationPayload.decision_dashboard ?? {},
    final_conclusion:publicationPayload.final_conclusion ?? {},
  };
}

function sortedRows(values,keyFn) {
  return [...(Array.isArray(values)?values:[])].sort((a,b)=>keyFn(a).localeCompare(keyFn(b)));
}

export function canonicalPublicationArtifact(packagePayload) {
  const artifact=structuredClone(packagePayload);
  artifact.metric_observations=sortedRows(artifact.metric_observations,(r)=>[r?.module??"universal",r?.metric_key??"",r?.period_end??""].join("|"));
  artifact.risk_register=sortedRows(artifact.risk_register,(r)=>[r?.risk_key??"",r?.title??""].join("|"));
  artifact.expected_return_scenarios=sortedRows(artifact.expected_return_scenarios,(r)=>[r?.scenario??"",String(r?.horizon_years??"")].join("|"));
  artifact.thesis_variables=sortedRows(artifact.thesis_variables,(r)=>String(r?.variable_name??""));
  artifact.sources=sortedRows(artifact.sources,(r)=>[r?.source_type??"",r?.title??"",r?.url??""].join("|"));
  artifact.fundamental_scorecard=sortedRows(artifact.fundamental_scorecard,(r)=>String(r?.metric??""));
  return artifact;
}

export function buildPublicationIntegrity({draft,review,composition,packagePayload,readiness,manifest=null}) {
  const canonicalArtifact=canonicalPublicationArtifact(packagePayload);
  const evidencePackage={
    source_cutoff_at:draft?.source_cutoff_at ?? null,
    evidence_summary:draft?.evidence_summary ?? {},
    metric_observations:canonicalArtifact.metric_observations,
    sources:canonicalArtifact.sources,
  };
  const normalizedInputs={
    financial_metrics:packagePayload.financial_metrics,
    metric_observations:canonicalArtifact.metric_observations,
    business_assessment:packagePayload.business_assessment,
    investment_thesis:packagePayload.investment_thesis,
    financial_quality:packagePayload.financial_quality,
    fundamental_scorecard:canonicalArtifact.fundamental_scorecard,
    competitive_position:packagePayload.competitive_position,
    provenance_manifest:manifest ? {
      manifest_version:manifest.manifest_version,
      manifest_hash:manifest.manifest_hash,
      cutoff_at:manifest.cutoff_at,
      provenance_status:manifest.provenance_status,
      item_hashes:(manifest.items ?? []).map((item)=>item.input_hash).sort(),
    } : null,
  };
  const valuationInputs={
    research:{
      price_at_research:packagePayload.research?.price_at_research ?? null,
      data_cutoff_at:packagePayload.research?.data_cutoff_at ?? null,
      benchmark_ticker:packagePayload.research?.benchmark_ticker ?? "SPY",
    },
    financial_metrics:packagePayload.financial_metrics,
    valuation_assumptions:packagePayload.valuation_analysis?.assumptions ?? {},
    historical_valuation:packagePayload.historical_valuation,
    competitive_position:packagePayload.competitive_position,
  };
  return {
    integrity_version:"historical-integrity-v1",
    publication_engine_version:"reviewed-v2-publisher-v1",
    methodology_version:(packagePayload.research?.standard_version ?? "solpient-v2")+":"+(composition?.engine_version ?? "composer-unknown"),
    canonicalization_version:CANONICALIZATION_VERSION,
    evidence_hash:canonicalSha256(evidencePackage),
    normalized_inputs_hash:canonicalSha256(normalizedInputs),
    valuation_inputs_hash:canonicalSha256(valuationInputs),
    composition_hash:canonicalSha256(composition?.composition_payload ?? {}),
    published_output_hash:canonicalSha256(canonicalArtifact),
    standard_status:readiness.standard.status,
    completeness_pct:readiness.standard.completenessPct,
    validation_notes:readiness.standard.notes,
    validation_result:readiness.standard,
    promotion_readiness:readiness,
    review_id:review?.id ?? null,
    supersedes_id:packagePayload.research?.supersedes_id ?? null,
    correction_reason:packagePayload.research?.correction_reason ?? null,
    provenance_version:manifest?.manifest_version ?? null,
    input_manifest_hash:manifest?.manifest_hash ?? null,
  };
}

export async function promoteReviewedBaseline({ supabase, draft, review, payload, promotedAt = new Date().toISOString() }) {
  const readiness = validatePromotionReadiness(payload);
  if (!readiness.ready) throw new Error("Promotion blocked: " + readiness.blockers.join(" "));

  if (draft?.published_run_id) {
    return { id:draft.published_run_id, alreadyPublished:true, readiness };
  }

  const ingestionKey="baseline-draft:"+draft.id;
  const {data:existing,error:existingError}=await supabase
    .from("research_runs").select("id,version").eq("ingestion_key",ingestionKey).maybeSingle();
  if (existingError) throw existingError;
  if (existing) return {id:existing.id,version:existing.version,alreadyPublished:true,readiness};

  const companyId=draft.company_id;
  const [latestRunResult,compositionResult]=await Promise.all([
    supabase.from("research_runs").select("id,version,price_at_research")
      .eq("company_id",companyId).order("version",{ascending:false}).limit(1).maybeSingle(),
    supabase.from("research_compositions").select("*")
      .eq("draft_id",draft.id).eq("status","applied")
      .order("generated_at",{ascending:false}).limit(1).maybeSingle(),
  ]);
  if (latestRunResult.error) throw latestRunResult.error;
  if (compositionResult.error) throw compositionResult.error;
  const latestRun=latestRunResult.data;
  const composition=compositionResult.data;
  if (!composition) throw new Error("Promotion blocked: an applied Research Composer package is required.");

  let previousMetrics=null,previousScores=null,previousValuation=null,previousThesis=[];
  if (latestRun) {
    const results=await Promise.all([
      supabase.from("financial_metrics").select("*").eq("research_run_id",latestRun.id).maybeSingle(),
      supabase.from("scores").select("*").eq("research_run_id",latestRun.id).maybeSingle(),
      supabase.from("valuations").select("*").eq("research_run_id",latestRun.id).maybeSingle(),
      supabase.from("thesis_variables").select("*").eq("research_run_id",latestRun.id),
    ]);
    for (const result of results) if (result.error) throw result.error;
    previousMetrics=results[0].data;
    previousScores=results[1].data;
    previousValuation=results[2].data;
    previousThesis=results[3].data ?? [];
  }

  const packagePayload=buildPublicationPackage(payload,promotedAt);
  if (packagePayload.research?.standard_version!=="solpient-v2") {
    throw new Error("Promotion blocked: authoritative publication requires Research Standard v2.");
  }

  const manifest=await buildResearchInputManifest(supabase,{
    draft,composition,packagePayload,
  });
  await stageResearchInputManifest(supabase,manifest);

  const changes=buildResearchChanges({
    companyId,currentRunId:null,previousRun:latestRun,payload:packagePayload,
    previousMetrics,previousScores,previousValuation,previousThesis,
  });
  const integrity=buildPublicationIntegrity({
    draft,review,composition,packagePayload,readiness,manifest,
  });

  const {data,error}=await supabase.rpc("publish_reviewed_research_v2",{
    p_draft_id:draft.id,
    p_review_id:review.id,
    p_composition_id:composition.id,
    p_expected_previous_run_id:latestRun?.id ?? null,
    p_package:packagePayload,
    p_integrity:integrity,
    p_changes:changes,
  });
  if (error) throw error;

  return {
    id:data?.id,
    version:data?.version,
    alreadyPublished:Boolean(data?.alreadyPublished),
    readiness,
    payload:packagePayload,
    integrity,
    manifest:{
      manifest_version:manifest.manifest_version,
      manifest_hash:manifest.manifest_hash,
      provenance_status:manifest.provenance_status,
      total_inputs:manifest.items.length,
    },
  };
}
