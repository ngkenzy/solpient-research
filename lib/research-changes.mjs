function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function percentDelta(oldValue, newValue) {
  const oldN = asNumber(oldValue);
  const newN = asNumber(newValue);
  if (oldN == null || newN == null || oldN === 0) return null;
  return ((newN - oldN) / Math.abs(oldN)) * 100;
}

function addNumericChange(changes, {
  companyId,
  currentRunId,
  previousRunId,
  category,
  metricKey,
  label,
  oldValue,
  newValue,
  absThreshold = 0,
  relativeThreshold = 0,
  materiality = "material",
  suffix = "",
}) {
  const oldN = asNumber(oldValue);
  const newN = asNumber(newValue);

  if (oldN == null || newN == null) return;

  const delta = newN - oldN;
  const relative = percentDelta(oldN, newN);

  const absTriggered =
    absThreshold > 0 && Math.abs(delta) >= absThreshold;
  const relativeTriggered =
    relativeThreshold > 0 &&
    relative != null &&
    Math.abs(relative) >= relativeThreshold;
  const anyChangeTriggered =
    absThreshold <= 0 &&
    relativeThreshold <= 0 &&
    delta !== 0;

  const isMaterial =
    absTriggered || relativeTriggered || anyChangeTriggered;

  if (!isMaterial) return;

  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "unchanged";
  const signedDelta = `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}${suffix}`;
  const relText =
    relative == null
      ? ""
      : ` (${relative >= 0 ? "+" : ""}${relative.toFixed(1)}%)`;

  changes.push({
    company_id: companyId,
    current_run_id: currentRunId,
    previous_run_id: previousRunId,
    category,
    change_type: "metric",
    metric_key: metricKey,
    label,
    old_value: oldN,
    new_value: newN,
    delta_value: delta,
    delta_percent: relative,
    direction,
    materiality,
    summary: `${label} moved ${direction} by ${signedDelta}${relText}.`,
  });
}

export function buildResearchChanges({
  companyId,
  currentRunId,
  previousRun,
  payload,
  previousMetrics = null,
  previousScores = null,
  previousValuation = null,
  previousThesis = [],
}) {
  if (!previousRun) return [];

  const changes = [];
  const previousRunId = previousRun.id;

  addNumericChange(changes, {
    companyId,
    currentRunId,
    previousRunId,
    category: "market",
    metricKey: "price_at_research",
    label: "Price at research",
    oldValue: previousRun.price_at_research,
    newValue: payload.research?.price_at_research,
    relativeThreshold: 3,
  });

  const metricRules = [
    ["revenue_growth_1y", "Revenue growth", 1, 0, "pp"],
    ["revenue_cagr_5y", "5Y revenue CAGR", 1, 0, "pp"],
    ["gross_margin", "Gross margin", 1, 0, "pp"],
    ["operating_margin", "Operating margin", 1, 0, "pp"],
    ["net_margin", "Net margin", 1, 0, "pp"],
    ["fcf_margin", "FCF margin", 1, 0, "pp"],
    ["roe", "ROE", 1, 0, "pp"],
    ["roic", "ROIC", 1, 0, "pp"],
    ["roa", "ROA", 1, 0, "pp"],
    ["eps_growth_1y", "EPS growth", 2, 0, "pp"],
    ["current_ratio", "Current ratio", 0.1, 0, ""],
    ["quick_ratio", "Quick ratio", 0.1, 0, ""],
    ["debt_to_equity", "Debt / equity", 0.1, 0, ""],
    ["pe", "P/E", 1, 0, "x"],
    ["forward_pe", "Forward P/E", 1, 0, "x"],
    ["peg", "PEG", 0.2, 0, ""],
    ["revenue", "Revenue", 0, 5, ""],
    ["free_cash_flow", "Free cash flow", 0, 5, ""],
    ["cash", "Cash", 0, 10, ""],
    ["total_debt", "Total debt", 0, 10, ""],
  ];

  for (const [key, label, absThreshold, relativeThreshold, suffix] of metricRules) {
    addNumericChange(changes, {
      companyId,
      currentRunId,
      previousRunId,
      category: "financial",
      metricKey: key,
      label,
      oldValue: previousMetrics?.[key],
      newValue: payload.financial_metrics?.[key],
      absThreshold,
      relativeThreshold,
      suffix,
    });
  }

  const scoreRules = [
    ["overall_score", "Overall score"],
    ["quality_score", "Quality score"],
    ["growth_score", "Growth score"],
    ["valuation_score", "Valuation score"],
    ["financial_strength_score", "Financial strength score"],
    ["moat_score", "Moat score"],
    ["thesis_integrity_score", "Thesis integrity score"],
  ];

  for (const [key, label] of scoreRules) {
    addNumericChange(changes, {
      companyId,
      currentRunId,
      previousRunId,
      category: "score",
      metricKey: key,
      label,
      oldValue: previousScores?.[key],
      newValue: payload.scores?.[key],
      absThreshold: 3,
      suffix: " pts",
    });
  }

  const valuationRules = [
    ["bear_value", "Bear fair value"],
    ["base_value", "Base fair value"],
    ["bull_value", "Bull fair value"],
    ["dcf_value", "DCF value"],
    ["owner_earnings_value", "Owner earnings value"],
    ["earnings_multiple_value", "Earnings multiple value"],
  ];

  for (const [key, label] of valuationRules) {
    addNumericChange(changes, {
      companyId,
      currentRunId,
      previousRunId,
      category: "valuation",
      metricKey: key,
      label,
      oldValue: previousValuation?.[key],
      newValue: payload.valuations?.[key],
      relativeThreshold: 5,
    });
  }

  const previousThesisMap = new Map(
    previousThesis.map((item) => [
      String(item.variable_name).trim().toLowerCase(),
      item,
    ])
  );

  const currentThesis = Array.isArray(payload.thesis_variables)
    ? payload.thesis_variables
    : [];
  const currentNames = new Set();

  for (const item of currentThesis) {
    const normalizedName = String(item.variable_name).trim().toLowerCase();
    currentNames.add(normalizedName);
    const previous = previousThesisMap.get(normalizedName);

    if (!previous) {
      changes.push({
        company_id: companyId,
        current_run_id: currentRunId,
        previous_run_id: previousRunId,
        category: "thesis",
        change_type: "new",
        metric_key: `thesis:${normalizedName}`,
        label: item.variable_name,
        old_text: null,
        new_text: item.observed_value ?? item.expectation ?? null,
        direction: item.status ?? "new",
        materiality: "material",
        summary: `New thesis condition added: ${item.variable_name}.`,
      });
      continue;
    }

    const statusChanged =
      (previous.status ?? "unknown") !== (item.status ?? "unknown");
    const evidenceChanged =
      String(previous.observed_value ?? "").trim() !==
      String(item.observed_value ?? "").trim();

    if (statusChanged || evidenceChanged) {
      const statusText = statusChanged
        ? ` status changed from ${previous.status ?? "unknown"} to ${item.status ?? "unknown"}.`
        : " evidence was updated.";

      changes.push({
        company_id: companyId,
        current_run_id: currentRunId,
        previous_run_id: previousRunId,
        category: "thesis",
        change_type: statusChanged ? "status" : "evidence",
        metric_key: `thesis:${normalizedName}`,
        label: item.variable_name,
        old_text: previous.observed_value ?? previous.expectation ?? null,
        new_text: item.observed_value ?? item.expectation ?? null,
        direction: item.status ?? "unknown",
        materiality: statusChanged ? "material" : "notable",
        summary: `${item.variable_name}:${statusText}`,
      });
    }
  }

  for (const previous of previousThesis) {
    const normalizedName = String(previous.variable_name).trim().toLowerCase();
    if (currentNames.has(normalizedName)) continue;

    changes.push({
      company_id: companyId,
      current_run_id: currentRunId,
      previous_run_id: previousRunId,
      category: "thesis",
      change_type: "removed",
      metric_key: `thesis:${normalizedName}`,
      label: previous.variable_name,
      old_text: previous.observed_value ?? previous.expectation ?? null,
      new_text: null,
      direction: "removed",
      materiality: "material",
      summary: `Thesis condition removed: ${previous.variable_name}.`,
    });
  }

  return changes;
}
