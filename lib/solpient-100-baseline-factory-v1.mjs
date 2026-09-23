export const SOLPIENT_100_BASELINE_FACTORY_VERSION =
  "solpient-100-baseline-factory-v1";

export const BASELINE_FACTORY_TARGETS = Object.freeze({
  minimum_sec_fundamental_rows: 8,
  minimum_total_fundamental_rows: 8,
  minimum_market_days: 756,
});

function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ms(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function newest(...values) {
  const parsed = values.map(ms).filter((value) => value != null);
  return parsed.length ? Math.max(...parsed) : null;
}

function olderThan(value, comparison) {
  const left = ms(value);
  if (comparison == null) return false;
  if (left == null) return true;
  return left < comparison;
}

export function deriveSolpient100BaselinePlan(
  state = {},
  targets = BASELINE_FACTORY_TARGETS,
) {
  const ticker = String(state.ticker ?? "").toUpperCase();
  const steps = [];
  const blockers = [];
  const warnings = [];

  if (!ticker) {
    return {
      ticker,
      status: "blocked",
      complete: false,
      blockers: ["ticker_missing"],
      warnings,
      steps,
      needs_composition: false,
    };
  }

  if (state.published_research_run_id) {
    return {
      ticker,
      status: "published",
      complete: true,
      blockers,
      warnings,
      steps,
      needs_composition: false,
      reason: "published_research_exists",
    };
  }

  if (!state.company_id) {
    blockers.push("canonical_identity_missing");
    return {
      ticker,
      status: "blocked",
      complete: false,
      blockers,
      warnings,
      steps: ["onboard_identity"],
      needs_composition: false,
    };
  }

  if (!state.industry_assignment_id || !state.industry_module) {
    steps.push("assign_industry");
    warnings.push("industry_assignment_missing");
  }

  if (n(state.sec_fundamental_rows) < targets.minimum_sec_fundamental_rows) {
    steps.push("sync_sec_fundamentals");
  }

  if (n(state.fundamental_rows) < targets.minimum_total_fundamental_rows) {
    steps.push("sync_yahoo_fundamentals");
  }

  if (n(state.market_days) < targets.minimum_market_days) {
    steps.push("sync_market_history");
  }

  const rawEvidenceAt = newest(
    state.latest_fundamental_observed_at,
    state.latest_market_observed_at,
  );
  const contextAt =
    ms(state.context_knowledge_cutoff_at) ??
    ms(state.context_generated_at);
  const contextStale =
    !state.context_pack_id ||
    (rawEvidenceAt != null && olderThan(contextAt, rawEvidenceAt));

  if (contextStale) {
    steps.push("build_historical_peer_context");
  }

  const effectiveContextAt = contextAt ?? rawEvidenceAt;
  const evidenceAt = newest(rawEvidenceAt, effectiveContextAt);
  const baselineStale =
    !state.baseline_draft_id ||
    olderThan(
      state.baseline_source_cutoff_at ?? state.baseline_generated_at,
      evidenceAt,
    ) ||
    (state.industry_module &&
      state.baseline_industry_module !== state.industry_module);

  if (baselineStale) {
    steps.push("build_baseline_draft");
  }

  const baselineAt = ms(state.baseline_generated_at);
  const coverageStale =
    !state.coverage_report_id ||
    (baselineAt != null && olderThan(state.coverage_generated_at, baselineAt));

  if (coverageStale) {
    steps.push("build_coverage");
  }

  const valuationStale =
    !state.valuation_draft_id ||
    (baselineAt != null && olderThan(state.valuation_created_at, baselineAt));

  if (valuationStale) {
    steps.push("build_valuation_evidence");
  }

  const compositionInvalid =
    state.composition_valid !== true ||
    !state.composition_id ||
    !state.baseline_draft_id ||
    state.composition_draft_id !== state.baseline_draft_id;

  const needsComposition = baselineStale || compositionInvalid;
  if (needsComposition) {
    steps.push("compose_and_persist_baseline");
  }

  const complete =
    steps.length === 0 &&
    !needsComposition &&
    Boolean(state.composition_id) &&
    state.composition_valid === true;

  return {
    ticker,
    status: complete
      ? state.composition_public_ready
        ? "baseline_ready"
        : "baseline_building"
      : "work_required",
    complete,
    blockers,
    warnings,
    steps,
    needs_composition: needsComposition,
    current: {
      industry_module: state.industry_module ?? null,
      fundamental_rows: n(state.fundamental_rows),
      sec_fundamental_rows: n(state.sec_fundamental_rows),
      market_days: n(state.market_days),
      coverage_status: state.coverage_status ?? null,
      coverage_overall_pct:
        state.coverage_overall_pct == null
          ? null
          : Number(state.coverage_overall_pct),
      composition_valid: state.composition_valid === true,
      composition_public_ready: state.composition_public_ready === true,
    },
  };
}

function priority(plan, state) {
  if (plan.complete || plan.status === "published") return -1;
  if (plan.blockers.length) return 5;
  if (!state.composition_id) return 100;
  if (!state.baseline_draft_id) return 90;
  if (!state.coverage_report_id) return 80;
  if (plan.needs_composition) return 75;
  if (!state.industry_assignment_id) return 65;
  if (n(state.market_days) < BASELINE_FACTORY_TARGETS.minimum_market_days) return 55;
  if (
    n(state.sec_fundamental_rows) <
    BASELINE_FACTORY_TARGETS.minimum_sec_fundamental_rows
  ) {
    return 50;
  }
  return 20;
}

export function selectSolpient100BaselineWork(
  states = [],
  { ticker = null, maxItems = 5 } = {},
) {
  const wanted = ticker ? String(ticker).toUpperCase() : null;
  const candidates = states
    .map((state) => ({
      state,
      plan: deriveSolpient100BaselinePlan(state),
    }))
    .filter(({ state, plan }) => {
      if (wanted && String(state.ticker).toUpperCase() !== wanted) return false;
      if (plan.status === "published" || plan.complete) return false;
      if (plan.blockers.includes("canonical_identity_missing")) return false;
      return true;
    })
    .map((entry) => ({
      ...entry,
      priority: priority(entry.plan, entry.state),
    }))
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        n(a.state.ordinal) - n(b.state.ordinal) ||
        String(a.state.ticker).localeCompare(String(b.state.ticker)),
    );

  const max = wanted
    ? 1
    : Math.max(1, Math.min(100, Number(maxItems) || 5));
  return candidates.slice(0, max);
}

export function summarizeSolpient100BaselineStates(states = []) {
  const summary = {
    member_count: states.length,
    published_count: 0,
    baseline_ready_count: 0,
    baseline_building_count: 0,
    work_required_count: 0,
    blocked_count: 0,
    missing_composition_count: 0,
    missing_baseline_draft_count: 0,
    missing_industry_assignment_count: 0,
    insufficient_market_history_count: 0,
    insufficient_sec_fundamentals_count: 0,
  };

  for (const state of states) {
    const plan = deriveSolpient100BaselinePlan(state);
    if (plan.status === "published") summary.published_count += 1;
    else if (plan.status === "baseline_ready") summary.baseline_ready_count += 1;
    else if (plan.status === "baseline_building") summary.baseline_building_count += 1;
    else if (plan.status === "blocked") summary.blocked_count += 1;
    else summary.work_required_count += 1;

    if (!state.composition_id) summary.missing_composition_count += 1;
    if (!state.baseline_draft_id) summary.missing_baseline_draft_count += 1;
    if (!state.industry_assignment_id)
      summary.missing_industry_assignment_count += 1;
    if (n(state.market_days) < BASELINE_FACTORY_TARGETS.minimum_market_days)
      summary.insufficient_market_history_count += 1;
    if (
      n(state.sec_fundamental_rows) <
      BASELINE_FACTORY_TARGETS.minimum_sec_fundamental_rows
    ) {
      summary.insufficient_sec_fundamentals_count += 1;
    }
  }

  return summary;
}
