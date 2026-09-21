import { buildResearchChanges } from "./research-changes.mjs";
import { validatePromotionReadiness, materializeFinancialMetrics } from "./review-workbench.mjs";

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
  if (["strengthened","unchanged","weakened","unknown"].includes(status)) return status;
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

function normalizeSourceRows(values=[]) {
  return values.map((value)=>({
    source_type:value?.source_type ?? "Other",
    title:value?.title ?? "Source",
    url:value?.url ?? null,
    filing_date:value?.filing_date ?? null,
    accession_number:value?.accession_number ?? null,
    retrieved_at:value?.retrieved_at ?? new Date().toISOString(),
  }));
}

export async function promoteReviewedBaseline({ supabase, draft, review, payload, promotedAt = new Date().toISOString() }) {
  const readiness = validatePromotionReadiness(payload);
  if (!readiness.ready) throw new Error("Promotion blocked: " + readiness.blockers.join(" "));

  if (draft?.published_run_id) {
    await supabase.from("baseline_drafts").update({
      status:"promoted",updated_at:promotedAt,
    }).eq("id",draft.id);
    if (review?.id) {
      await supabase.from("baseline_reviews").update({
        status:"promoted",published_run_id:draft.published_run_id,
        promoted_at:review.promoted_at ?? promotedAt,updated_at:promotedAt,
      }).eq("id",review.id);
    }
    return { id: draft.published_run_id, alreadyPublished: true, readiness };
  }

  const ingestionKey = "baseline-draft:" + draft.id;
  const { data: existing, error: existingError } = await supabase
    .from("research_runs").select("id,version").eq("ingestion_key", ingestionKey).maybeSingle();
  if (existingError) throw existingError;

  if (existing) {
    await supabase.from("baseline_drafts").update({
      status:"promoted", published_run_id:existing.id, updated_at:promotedAt,
    }).eq("id", draft.id);
    if (review?.id) await supabase.from("baseline_reviews").update({
      status:"promoted", published_run_id:existing.id, promoted_at:promotedAt, updated_at:promotedAt,
    }).eq("id", review.id);
    return { id: existing.id, version: existing.version, alreadyPublished: true, readiness };
  }

  const companyId = draft.company_id;
  const { data: latestRun, error: latestRunError } = await supabase
    .from("research_runs").select("id,version,price_at_research")
    .eq("company_id", companyId).order("version", { ascending:false }).limit(1).maybeSingle();
  if (latestRunError) throw latestRunError;

  let previousMetrics=null, previousScores=null, previousValuation=null, previousThesis=[];
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

  const publicationPayload=structuredClone(payload);
  publicationPayload.research={...(publicationPayload.research ?? {}),status:"published",researched_at:promotedAt};
  publicationPayload.financial_metrics={
    ...materializeFinancialMetrics(publicationPayload),
    ...(publicationPayload.financial_metrics ?? {}),
  };
  if (publicationPayload.prediction) delete publicationPayload.prediction;

  const { data:run, error:runError }=await supabase.from("research_runs").insert({
    company_id:companyId,
    previous_run_id:latestRun?.id ?? null,
    version:Number(latestRun?.version ?? 0)+1,
    researched_at:promotedAt,
    price_at_research:publicationPayload.research.price_at_research ?? null,
    market_cap:publicationPayload.research.market_cap ?? null,
    source_period:publicationPayload.research.source_period ?? null,
    status:"published",
    summary:publicationPayload.research.summary ?? null,
    full_report:publicationPayload.research.full_report ?? null,
    ingestion_key:ingestionKey,
    standard_version:publicationPayload.research.standard_version ?? null,
    standard_status:readiness.standard.status,
    data_cutoff_at:publicationPayload.research.data_cutoff_at ?? null,
    benchmark_ticker:publicationPayload.research.benchmark_ticker ?? "SPY",
    completeness_pct:readiness.standard.completenessPct,
    validation_notes:readiness.standard.notes,
  }).select("id,version").single();
  if (runError) throw runError;

  async function insertOne(table,value) {
    if (!value || Object.keys(value).length===0) return;
    const { error }=await supabase.from(table).insert({...cleanRow(value),research_run_id:run.id});
    if (error) throw error;
  }
  async function insertMany(table,values) {
    if (!Array.isArray(values) || values.length===0) return;
    const { error }=await supabase.from(table).insert(values.map(value=>({...cleanRow(value),research_run_id:run.id})));
    if (error) throw error;
  }

  try {
    await insertOne("financial_metrics",publicationPayload.financial_metrics);
    await insertOne("scores",publicationPayload.scores);
    await insertOne("valuations",publicationPayload.valuations);
    await insertOne("business_assessments",normalizeBusinessAssessment(publicationPayload.business_assessment));
    await insertMany("metric_observations",publicationPayload.metric_observations);
    await insertMany("risk_register",normalizeRiskRows(publicationPayload.risk_register));
    await insertMany("expected_return_scenarios",normalizeExpectedReturnRows(publicationPayload.expected_return_scenarios));
    await insertMany("thesis_variables",normalizeThesisRows(publicationPayload.thesis_variables));
    await insertMany("sources",normalizeSourceRows(publicationPayload.sources));
    if (publicationPayload.research?.standard_version==="solpient-v2") {
      await insertOne("research_v2_sections",{investment_thesis:publicationPayload.investment_thesis??{},financial_quality:publicationPayload.financial_quality??{},fundamental_scorecard:publicationPayload.fundamental_scorecard??[],competitive_position:publicationPayload.competitive_position??{},valuation_analysis:publicationPayload.valuation_analysis??{},historical_valuation:publicationPayload.historical_valuation??{},investment_lenses:publicationPayload.investment_lenses??{},decision_dashboard:publicationPayload.decision_dashboard??{},final_conclusion:publicationPayload.final_conclusion??{}});
    }

    const changes=buildResearchChanges({
      companyId,currentRunId:run.id,previousRun:latestRun,payload:publicationPayload,
      previousMetrics,previousScores,previousValuation,previousThesis,
    });
    if (changes.length) {
      const { error }=await supabase.from("research_changes").insert(changes);
      if (error) throw error;
    }

    const { error:draftError }=await supabase.from("baseline_drafts").update({
      status:"promoted",published_run_id:run.id,standard_valid:true,
      standard_status:readiness.standard.status,validation_result:readiness.standard,updated_at:promotedAt,
    }).eq("id",draft.id);
    if (draftError) throw draftError;

    if (review?.id) {
      const { error:reviewError }=await supabase.from("baseline_reviews").update({
        status:"promoted",validation_result:readiness.standard,promotion_readiness:readiness,
        reviewed_at:review.reviewed_at ?? promotedAt,promoted_at:promotedAt,
        published_run_id:run.id,updated_at:promotedAt,
      }).eq("id",review.id);
      if (reviewError) throw reviewError;
    }

    return { id:run.id, version:run.version, alreadyPublished:false, readiness, payload:publicationPayload };
  } catch (error) {
    await supabase.from("research_runs").delete().eq("id",run.id);
    throw error;
  }
}
