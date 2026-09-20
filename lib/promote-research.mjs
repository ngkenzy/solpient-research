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

export async function promoteReviewedBaseline({ supabase, draft, review, payload, promotedAt = new Date().toISOString() }) {
  const readiness = validatePromotionReadiness(payload);
  if (!readiness.ready) throw new Error("Promotion blocked: " + readiness.blockers.join(" "));

  if (draft?.published_run_id) return { id: draft.published_run_id, alreadyPublished: true, readiness };

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
    await insertOne("business_assessments",publicationPayload.business_assessment);
    await insertMany("metric_observations",publicationPayload.metric_observations);
    await insertMany("risk_register",publicationPayload.risk_register);
    await insertMany("expected_return_scenarios",publicationPayload.expected_return_scenarios);
    await insertMany("thesis_variables",publicationPayload.thesis_variables);
    await insertMany("sources",publicationPayload.sources);

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
