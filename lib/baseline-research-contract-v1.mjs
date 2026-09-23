import { canonicalSha256 } from "./integrity-hash.mjs";
import { INDUSTRY_MODULES, industryModuleForTicker } from "./industry-modules.mjs";
import { V2_CORE_METRIC_KEYS } from "./research-standard-v2.mjs";

export const BASELINE_RESEARCH_CONTRACT_VERSION = "baseline-research-contract-v1";
export const BASELINE_COMPOSER_OUTPUT_VERSION = "baseline-research-composer-output-v1";

export const BASELINE_QUALITATIVE_SECTIONS = Object.freeze([
  "company_overview",
  "revenue_model",
  "customer_characteristics",
  "competitive_position",
  "moat_evidence",
  "pricing_power",
  "growth_drivers",
  "major_risks",
  "ai_opportunities",
  "ai_disruption_risks",
  "management_observations",
  "capital_allocation_observations",
  "bull_thesis",
  "bear_thesis",
  "biggest_unknowns",
]);

const REQUIRED_BASELINE_SECTIONS = new Set([
  "company_overview",
  "revenue_model",
  "competitive_position",
  "growth_drivers",
  "major_risks",
  "bull_thesis",
  "bear_thesis",
  "biggest_unknowns",
]);

const hasValue = (value) =>
  value !== null &&
  value !== undefined &&
  !(typeof value === "string" && value.trim() === "");

const numberOrNull = (value) => {
  if (!hasValue(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const upper = (value) => String(value ?? "").trim().toUpperCase();

function metricRows(draft) {
  if (Array.isArray(draft?.metric_observations)) return draft.metric_observations;
  if (Array.isArray(draft?.draft_payload?.metric_observations)) {
    return draft.draft_payload.metric_observations;
  }
  return [];
}

function sourceRows(draft) {
  if (Array.isArray(draft?.sources)) return draft.sources;
  if (Array.isArray(draft?.draft_payload?.sources)) return draft.draft_payload.sources;
  return [];
}

function normalizeMetric(row = {}) {
  return {
    module: row.module ?? "universal",
    metric_key: row.metric_key ?? null,
    label: row.label ?? row.metric_key ?? null,
    status: row.status ?? "available",
    basis: row.basis ?? "reported",
    value_numeric: numberOrNull(row.value_numeric),
    value_text: hasValue(row.value_text) ? String(row.value_text) : null,
    unit: row.unit ?? null,
    period_end: row.period_end ?? null,
    period_type: row.period_type ?? null,
    source_title: row.source_title ?? null,
    source_url: row.source_url ?? null,
    calculation_method: row.calculation_method ?? null,
    notes: row.notes ?? null,
  };
}

function metricEvidenceId(row, index) {
  const module = String(row.module ?? "universal").replaceAll(":", "_");
  const key = String(row.metric_key ?? "metric").replaceAll(":", "_");
  const period = String(row.period_end ?? row.period_type ?? index).replaceAll(":", "_");
  return `metric:${module}:${key}:${period}`;
}

function sourceEvidenceId(row, index) {
  const accession = String(row?.accession_number ?? "").trim();
  if (accession) return `source:sec:${accession.replaceAll(":", "_")}`;
  return `source:document:${index + 1}`;
}

function coverageEvidence(coverage = {}) {
  const keys = [
    "fundamentals_pct",
    "balance_sheet_pct",
    "history_pct",
    "market_history_pct",
    "industry_pct",
    "peer_pct",
    "valuation_history_pct",
    "capital_allocation_pct",
    "consensus_pct",
    "research_structure_pct",
    "decision_readiness_pct",
    "overall_pct",
  ];
  return keys
    .filter((key) => numberOrNull(coverage?.[key]) != null)
    .map((key) => ({
      id: `coverage:${key}`,
      kind: "coverage",
      label: key,
      value: numberOrNull(coverage[key]),
      unit: "percent",
      source: {
        engine_version: coverage.engine_version ?? null,
        as_of_date: coverage.as_of_date ?? null,
      },
    }));
}

function valuationEvidence(valuationDraft = null, publishedValuation = null) {
  const rows = [];
  const push = (id, label, value, meta = {}) => {
    const n = numberOrNull(value);
    if (n == null) return;
    rows.push({
      id: `valuation:${id}`,
      kind: "valuation",
      label,
      value: n,
      unit: meta.unit ?? "USD/share",
      source: meta.source ?? null,
    });
  };

  const input = valuationDraft?.valuation_input ?? {};
  const evidence = valuationDraft?.evidence ?? {};

  push("current_price", "Current price", input.currentPrice ?? publishedValuation?.price, {
    source: evidence.screen_price ?? null,
  });
  push("fcf_per_share", "Free cash flow per share", input.fcfPerShare, {
    source: evidence.fcf_per_share ?? null,
  });
  push("bear_value", "Bear fair value", publishedValuation?.bear_value);
  push("base_value", "Base fair value", publishedValuation?.base_value);
  push("bull_value", "Bull fair value", publishedValuation?.bull_value);
  push("mos_25_price", "25% margin-of-safety price", publishedValuation?.mos_25_price);
  push("mos_35_price", "35% margin-of-safety price", publishedValuation?.mos_35_price);

  return rows;
}

function deterministicSummary({ metrics, valuationEvidenceRows, coverage, candidate }) {
  const available = new Map(
    metrics
      .filter((row) => row.status === "available" && row.metric_key)
      .map((row) => [row.metric_key, row]),
  );
  const valuation = new Map(valuationEvidenceRows.map((row) => [row.id, row]));
  const currentPrice = numberOrNull(valuation.get("valuation:current_price")?.value);
  const baseValue = numberOrNull(valuation.get("valuation:base_value")?.value);
  const valuationGapPct =
    currentPrice != null && baseValue != null && baseValue !== 0
      ? ((baseValue - currentPrice) / baseValue) * 100
      : null;

  const metric = (key) => {
    const row = available.get(key);
    if (!row) return null;
    return {
      value_numeric: row.value_numeric,
      value_text: row.value_text,
      unit: row.unit,
      period_end: row.period_end,
      basis: row.basis,
    };
  };

  return {
    revenue_growth_1y: metric("revenue_growth_1y") ?? metric("revenue_growth"),
    gross_margin: metric("gross_margin"),
    operating_margin: metric("operating_margin"),
    net_margin: metric("net_margin"),
    free_cash_flow: metric("free_cash_flow"),
    fcf_margin: metric("fcf_margin"),
    cash: metric("cash"),
    total_debt: metric("total_debt"),
    net_debt: metric("net_debt"),
    shares_outstanding: metric("shares_outstanding"),
    forward_pe: metric("forward_pe"),
    price_to_fcf: metric("price_to_fcf"),
    fcf_yield: metric("fcf_yield"),
    current_price: currentPrice,
    base_fair_value: baseValue,
    valuation_gap_pct:
      valuationGapPct == null ? null : Math.round(valuationGapPct * 10) / 10,
    evidence_coverage_pct: numberOrNull(candidate?.evidence_coverage_pct),
    data_coverage_pct: numberOrNull(coverage?.overall_pct),
    decision_readiness_pct: numberOrNull(coverage?.decision_readiness_pct),
  };
}

function baselineGate({
  company,
  module,
  coverage,
  universalCovered,
  universalRequired,
  sectorCovered,
  sectorRequired,
  evidenceCount,
}) {
  const blockers = [];
  const warnings = [];

  if (!company?.id || !upper(company?.ticker)) blockers.push("canonical_company_identity_missing");
  if (!module || !INDUSTRY_MODULES[module]) blockers.push("industry_module_unreviewed");
  if (evidenceCount === 0) blockers.push("no_grounded_evidence");
  if (coverage?.status !== "sufficient") blockers.push("coverage_v2_not_sufficient");

  if (universalRequired > 0 && universalCovered < universalRequired) {
    warnings.push(
      `universal_metric_coverage_${universalCovered}_of_${universalRequired}`,
    );
  }
  if (sectorRequired > 0 && sectorCovered < sectorRequired) {
    blockers.push(`sector_metric_coverage_${sectorCovered}_of_${sectorRequired}`);
  }

  return {
    composer_allowed: Boolean(company?.id && upper(company?.ticker) && evidenceCount > 0),
    public_baseline_ready: blockers.length === 0,
    status: blockers.length === 0 ? "baseline_ready" : "building",
    blockers,
    warnings,
  };
}

export function buildBaselineEvidencePack({
  company,
  candidate = null,
  coverage = null,
  baselineDraft = null,
  valuationDraft = null,
  publishedValuation = null,
  latestMarket = null,
  industryModule = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!company || !upper(company.ticker)) {
    throw new Error("Baseline Research Contract V1 requires a canonical company with ticker.");
  }

  const module =
    industryModule ??
    coverage?.coverage_details?.industry_module ??
    industryModuleForTicker(company.ticker) ??
    null;

  const metrics = metricRows(baselineDraft).map(normalizeMetric);
  const sources = sourceRows(baselineDraft);

  const metricEvidence = metrics
    .filter((row) => row.status === "available" && (hasValue(row.value_numeric) || hasValue(row.value_text)))
    .map((row, index) => ({
      id: metricEvidenceId(row, index),
      kind: "metric",
      label: row.label,
      metric_key: row.metric_key,
      module: row.module,
      value_numeric: row.value_numeric,
      value_text: row.value_text,
      unit: row.unit,
      period_end: row.period_end,
      period_type: row.period_type,
      basis: row.basis,
      source: {
        title: row.source_title,
        url: row.source_url,
        calculation_method: row.calculation_method,
        notes: row.notes,
      },
    }));

  const documentEvidence = sources.map((row, index) => ({
    id: sourceEvidenceId(row, index),
    kind: "source_document",
    label: row.title ?? row.source_title ?? row.source_type ?? `Source ${index + 1}`,
    source_type: row.source_type ?? null,
    url: row.url ?? row.source_url ?? null,
    filing_date: row.filing_date ?? null,
    accession_number: row.accession_number ?? null,
  }));

  const valuationRows = valuationEvidence(
    valuationDraft,
    publishedValuation
      ? { ...publishedValuation, price: latestMarket?.price ?? publishedValuation?.price }
      : latestMarket?.price != null
        ? { price: latestMarket.price }
        : null,
  );

  const coverageRows = coverageEvidence(coverage);

  const universalRows = metrics.filter((row) => row.module === "universal");
  const universalAvailable = new Set(
    universalRows
      .filter((row) => ["available", "not_applicable"].includes(row.status))
      .map((row) => row.metric_key),
  );
  const universalRequired = V2_CORE_METRIC_KEYS.length;
  const universalCovered = V2_CORE_METRIC_KEYS.filter((key) => universalAvailable.has(key)).length;

  const sectorRequiredKeys = module && INDUSTRY_MODULES[module]
    ? INDUSTRY_MODULES[module].requiredMetricKeys ?? []
    : [];
  const sectorAvailable = new Set(
    metrics
      .filter(
        (row) =>
          row.module === module &&
          ["available", "not_applicable"].includes(row.status),
      )
      .map((row) => row.metric_key),
  );
  const sectorCovered = sectorRequiredKeys.filter((key) => sectorAvailable.has(key)).length;

  const evidenceItems = [
    ...metricEvidence,
    ...documentEvidence,
    ...valuationRows,
    ...coverageRows,
  ];

  const gate = baselineGate({
    company,
    module,
    coverage,
    universalCovered,
    universalRequired,
    sectorCovered,
    sectorRequired: sectorRequiredKeys.length,
    evidenceCount: evidenceItems.length,
  });

  const coverageMissing = Array.isArray(coverage?.missing_fields)
    ? coverage.missing_fields.map((row) => ({
        kind: "coverage_gap",
        layer: row.layer ?? null,
        field: row.field ?? null,
        have: row.have ?? null,
        target: row.target ?? null,
      }))
    : [];

  const gaps = [
    ...coverageMissing,
    ...V2_CORE_METRIC_KEYS
      .filter((key) => !universalAvailable.has(key))
      .map((key) => ({ kind: "missing_universal_metric", metric_key: key })),
    ...sectorRequiredKeys
      .filter((key) => !sectorAvailable.has(key))
      .map((key) => ({ kind: "missing_sector_metric", module, metric_key: key })),
  ];

  if (!module || !INDUSTRY_MODULES[module]) {
    gaps.unshift({
      kind: "industry_module_review",
      ticker: upper(company.ticker),
      message:
        "No reviewed industry module is assigned. Universal evidence may support a Building-stage baseline, but sector-specific conclusions are not decision-grade.",
    });
  }

  const packWithoutHash = {
    contract_version: BASELINE_RESEARCH_CONTRACT_VERSION,
    generated_at: generatedAt,
    company: {
      id: company.id ?? null,
      ticker: upper(company.ticker),
      company_name: company.company_name ?? null,
      sector: company.sector ?? null,
      industry: company.industry ?? null,
      cik: company.cik ?? null,
      exchange: company.exchange ?? null,
    },
    membership: {
      candidate_stage: candidate?.stage ?? null,
      candidate_readiness_state: candidate?.readiness_state ?? null,
      shortlist_rank: numberOrNull(candidate?.shortlist_rank),
      universe_rank: numberOrNull(candidate?.universe_rank),
      screen_score: numberOrNull(candidate?.screen_score),
      quality_core_score: numberOrNull(candidate?.quality_core_score),
      evidence_coverage_pct: numberOrNull(candidate?.evidence_coverage_pct),
    },
    sector_evidence: {
      industry_module: module,
      reviewed_module: Boolean(module && INDUSTRY_MODULES[module]),
      required_metric_keys: sectorRequiredKeys,
      covered_required_metrics: sectorCovered,
      required_metric_count: sectorRequiredKeys.length,
      coverage_pct:
        sectorRequiredKeys.length === 0
          ? module && INDUSTRY_MODULES[module]
            ? 100
            : 0
          : Math.round((sectorCovered / sectorRequiredKeys.length) * 1000) / 10,
    },
    universal_evidence: {
      required_metric_keys: V2_CORE_METRIC_KEYS,
      covered_required_metrics: universalCovered,
      required_metric_count: universalRequired,
      coverage_pct:
        universalRequired === 0
          ? 100
          : Math.round((universalCovered / universalRequired) * 1000) / 10,
    },
    deterministic_summary: deterministicSummary({
      metrics,
      valuationEvidenceRows: valuationRows,
      coverage,
      candidate,
    }),
    evidence_items: evidenceItems,
    evidence_gaps: gaps,
    baseline_gate: gate,
    composer_contract: {
      output_version: BASELINE_COMPOSER_OUTPUT_VERSION,
      required_sections: BASELINE_QUALITATIVE_SECTIONS,
      required_for_public_baseline: [...REQUIRED_BASELINE_SECTIONS],
      rule:
        "Every qualitative claim must cite one or more evidence_items IDs. If evidence is insufficient, return status=insufficient_evidence for that section instead of inventing a conclusion.",
    },
    provenance: {
      coverage_engine_version: coverage?.engine_version ?? null,
      coverage_as_of_date: coverage?.as_of_date ?? null,
      baseline_draft_id: baselineDraft?.id ?? null,
      valuation_draft_id: valuationDraft?.id ?? null,
      source_count: documentEvidence.length,
      metric_evidence_count: metricEvidence.length,
    },
  };

  return {
    ...packWithoutHash,
    evidence_pack_hash: canonicalSha256(packWithoutHash),
  };
}

function normalizeSection(section) {
  const status = section?.status ?? null;
  const claims = Array.isArray(section?.claims) ? section.claims : [];
  return {
    status,
    claims,
    limitation:
      typeof section?.limitation === "string" && section.limitation.trim()
        ? section.limitation.trim()
        : null,
  };
}

export function validateBaselineComposerOutput(evidencePack, output) {
  const errors = [];
  const warnings = [];

  if (!evidencePack || evidencePack.contract_version !== BASELINE_RESEARCH_CONTRACT_VERSION) {
    errors.push("invalid_evidence_pack_contract");
  }
  if (output?.output_version !== BASELINE_COMPOSER_OUTPUT_VERSION) {
    errors.push("invalid_composer_output_version");
  }
  if (output?.evidence_pack_hash !== evidencePack?.evidence_pack_hash) {
    errors.push("evidence_pack_hash_mismatch");
  }
  if (upper(output?.company?.ticker) !== upper(evidencePack?.company?.ticker)) {
    errors.push("ticker_mismatch");
  }

  const validRefs = new Set((evidencePack?.evidence_items ?? []).map((row) => row.id));
  const sections = output?.sections ?? {};

  for (const key of BASELINE_QUALITATIVE_SECTIONS) {
    const section = normalizeSection(sections[key]);
    if (!["supported", "insufficient_evidence"].includes(section.status)) {
      errors.push(`section_${key}_invalid_status`);
      continue;
    }

    if (section.status === "insufficient_evidence") {
      if (!section.limitation) errors.push(`section_${key}_missing_limitation`);
      if (section.claims.length > 0) warnings.push(`section_${key}_claims_ignored_when_insufficient`);
      continue;
    }

    if (section.claims.length === 0) {
      errors.push(`section_${key}_supported_without_claims`);
      continue;
    }

    for (let index = 0; index < section.claims.length; index += 1) {
      const claim = section.claims[index] ?? {};
      if (typeof claim.text !== "string" || !claim.text.trim()) {
        errors.push(`section_${key}_claim_${index}_missing_text`);
      }
      const refs = Array.isArray(claim.evidence_refs) ? claim.evidence_refs : [];
      if (refs.length === 0) {
        errors.push(`section_${key}_claim_${index}_ungrounded`);
        continue;
      }
      for (const ref of refs) {
        if (!validRefs.has(ref)) {
          errors.push(`section_${key}_claim_${index}_unknown_evidence_ref:${ref}`);
        }
      }
    }
  }

  const publicSectionFailures = [...REQUIRED_BASELINE_SECTIONS].filter((key) => {
    const section = normalizeSection(sections[key]);
    return section.status !== "supported" || section.claims.length === 0;
  });

  const structurallyValid = errors.length === 0;
  const publicBaselineReady =
    structurallyValid &&
    Boolean(evidencePack?.baseline_gate?.public_baseline_ready) &&
    publicSectionFailures.length === 0;

  return {
    valid: structurallyValid,
    public_baseline_ready: publicBaselineReady,
    status: publicBaselineReady ? "baseline_ready" : "building",
    public_section_failures: publicSectionFailures,
    errors,
    warnings,
  };
}

export function baselineResearchState({
  evidencePack,
  composerValidation = null,
  candidateReadinessState = null,
} = {}) {
  if (candidateReadinessState === "decision_ready") return "decision_ready";
  if (candidateReadinessState === "research_ready") return "research_ready";
  if (composerValidation?.public_baseline_ready) return "baseline_ready";
  if (evidencePack?.baseline_gate?.composer_allowed) return "building";
  return "blocked";
}
