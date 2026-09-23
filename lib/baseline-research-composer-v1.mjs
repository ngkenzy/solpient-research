import {
  BASELINE_COMPOSER_OUTPUT_VERSION,
  BASELINE_QUALITATIVE_SECTIONS,
} from "./baseline-research-contract-v1.mjs";

export const BASELINE_RESEARCH_COMPOSER_VERSION = "baseline-research-composer-v1";

const BANK_MODULES = new Set(["financial_bank", "financial_insurance", "financial_services"]);
const REIT_MODULES = new Set(["reit", "real_estate", "real_estate_reit"]);
const SOFTWARE_FCF_KEYS = new Set([
  "free_cash_flow",
  "fcf_margin",
  "fcf_yield",
  "price_to_fcf",
  "fcf_per_share",
]);

function hasValue(value) {
  return value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "");
}

function formatItem(item) {
  const label = item.label ?? item.metric_key ?? item.id;
  if (hasValue(item.value_text)) return `${label}: ${item.value_text}`;
  if (item.value_numeric != null) {
    const unit = item.unit ? ` ${item.unit}` : "";
    const period = item.period_end ? ` (${item.period_end})` : "";
    return `${label} ${item.value_numeric}${unit}${period}`;
  }
  return label;
}

function pick(items, predicate) {
  return items.filter((item) => predicate(item));
}

function supported(claims) {
  return { status: "supported", claims, limitation: null };
}

function insufficient(limitation) {
  return { status: "insufficient_evidence", claims: [], limitation };
}

function claim(text, refs) {
  return { text, evidence_refs: [...new Set(refs.filter(Boolean))] };
}

function moduleOf(pack) {
  return pack?.sector_evidence?.industry_module ?? null;
}

function isReviewed(pack) {
  return Boolean(pack?.sector_evidence?.reviewed_module);
}

function suppressFcf(pack) {
  const module = moduleOf(pack);
  return BANK_MODULES.has(module) || REIT_MODULES.has(module) || !module;
}

function usableMetrics(pack) {
  const metrics = (pack.evidence_items ?? []).filter((item) => item.kind === "metric");
  if (!suppressFcf(pack)) return metrics;
  return metrics.filter((item) => !SOFTWARE_FCF_KEYS.has(item.metric_key));
}

function sources(pack) {
  return (pack.evidence_items ?? []).filter((item) => item.kind === "source_document");
}

function identity(pack) {
  return (pack.evidence_items ?? []).find((item) => item.kind === "company_identity") ?? null;
}

function sectorAssignment(pack) {
  return (pack.evidence_items ?? []).find((item) => item.kind === "sector_assignment") ?? null;
}

function gapItems(pack) {
  return (pack.evidence_items ?? []).filter((item) => item.kind === "evidence_gap");
}

function valuations(pack) {
  return (pack.evidence_items ?? []).filter((item) => item.kind === "valuation");
}

function coverage(pack) {
  return (pack.evidence_items ?? []).filter((item) => item.kind === "coverage");
}

function metricsByKey(metrics, keys) {
  const want = new Set(keys);
  return metrics.filter((item) => want.has(item.metric_key));
}

function anyTextMentionsAi(items) {
  return items.some((item) =>
    /\bai\b|artificial intelligence|machine learning|generative/i.test(
      `${item.label ?? ""} ${item.value_text ?? ""} ${item.source?.title ?? ""} ${item.source?.notes ?? ""}`,
    ),
  );
}

function companyOverview(pack, metrics, docs) {
  const companyIdentity = identity(pack);
  const assignment = sectorAssignment(pack);
  const name = companyIdentity?.company_name ?? pack.company?.company_name ?? pack.company?.ticker;
  const sector = companyIdentity?.sector ?? pack.company?.sector;
  const refs = [companyIdentity?.id, assignment?.id].filter(Boolean);
  const parts = [`${name} is the canonical company in the evidence pack`];
  if (docs[0]) {
    parts.push(`with source ${docs[0].label}`);
    refs.push(docs[0].id);
  }
  const margin = metricsByKey(metrics, ["operating_margin", "gross_margin", "net_margin"])[0];
  if (margin) {
    parts.push(`and reports ${formatItem(margin)}`);
    refs.push(margin.id);
  }
  const growth = metricsByKey(metrics, ["revenue_growth_1y", "revenue_growth"])[0];
  if (growth) {
    parts.push(`and ${formatItem(growth)}`);
    refs.push(growth.id);
  }
  if (sector) parts.push(`Sector label in the pack: ${sector}.`);
  if (!refs.length) {
    return insufficient(
      "No company identity, metric, source document, or sector-assignment evidence_item is available to ground a company overview.",
    );
  }
  const module = moduleOf(pack);
  if (!isReviewed(pack)) {
    parts.push("No reviewed industry module is assigned; sector conclusions stay limited.");
  } else if (module) {
    parts.push(`Reviewed industry module: ${module}.`);
  }
  return supported([claim(parts.join(" "), refs)]);
}

function revenueModel(pack, metrics, docs) {
  const module = moduleOf(pack);
  const assignment = sectorAssignment(pack);
  const rows = metricsByKey(metrics, [
    "revenue_growth_1y",
    "revenue_growth",
    "gross_margin",
    "operating_margin",
    "fcf_margin",
  ]);
  const refs = rows.map((row) => row.id);
  if (docs[0]) refs.push(docs[0].id);
  if (assignment) refs.push(assignment.id);
  if (!rows.length && !docs.length) {
    return insufficient("No revenue, margin, or source document is present in the evidence pack.");
  }
  const bits = rows.map(formatItem);
  let model = "Revenue-model mechanics are not described as text in the pack; only quantitative traces are cited.";
  if (module === "software_platform") {
    model =
      "Pack is assigned software_platform. Recurring-mix is not asserted unless a recurring-revenue metric exists.";
  } else if (module === "biopharma") {
    model = "Pack is assigned biopharma. Product/patent revenue mix is cited only from sector metrics present.";
  } else if (BANK_MODULES.has(module)) {
    model = "Pack is assigned a bank module. Software-style FCF is not used as the revenue model.";
  } else if (REIT_MODULES.has(module)) {
    model = "Pack is assigned a real-estate module. FFO/AFFO is used only if those metric keys exist.";
  }
  const sectorRows = metrics.filter((item) => item.module && item.module !== "universal");
  const extra = sectorRows.slice(0, 3).map(formatItem);
  sectorRows.slice(0, 3).forEach((row) => refs.push(row.id));
  return supported([
    claim(`${model} Observed: ${[...bits, ...extra].join("; ") || docs[0]?.label}.`, refs),
  ]);
}

function customers(pack, metrics, docs) {
  const rows = metrics.filter((item) =>
    /customer|retention|net_retention|churn|deposit|loan_book|occupancy|subscriber/i.test(
      `${item.metric_key} ${item.label ?? ""}`,
    ),
  );
  if (!rows.length) {
    return insufficient(
      "The pack has no customer, retention, deposit, occupancy, or similar metric. Customer characteristics are not inferred from sector labels.",
    );
  }
  return supported([
    claim(
      `Customer-related evidence in the pack: ${rows.map(formatItem).join("; ")}.`,
      rows.map((row) => row.id),
    ),
  ]);
}

function competitive(pack, metrics, docs) {
  const rows = metricsByKey(metrics, [
    "operating_margin",
    "gross_margin",
    "net_margin",
    "revenue_growth_1y",
    "revenue_growth",
  ]);
  if (!rows.length && !docs.length) {
    return insufficient("No margin, growth, or source evidence to ground competitive position.");
  }
  const refs = [...rows.map((row) => row.id), docs[0]?.id];
  return supported([
    claim(
      `Competitive position is limited to observed economics in the pack (${rows.map(formatItem).join("; ") || docs[0]?.label}). Peer comparison text is not present unless a peer metric exists.`,
      refs,
    ),
  ]);
}

function moat(pack, metrics) {
  const rows = metrics.filter((item) =>
    /moat|retention|switching|renewal|occupancy|cet1|capital_ratio|patent/i.test(
      `${item.metric_key} ${item.label ?? ""} ${item.value_text ?? ""}`,
    ),
  );
  if (!rows.length) {
    return insufficient(
      "No moat-labeled metric, retention, patent, occupancy, or capital-ratio evidence is in the pack. Margin level alone is not treated as a moat.",
    );
  }
  return supported([
    claim(`Moat-relevant evidence only: ${rows.map(formatItem).join("; ")}.`, rows.map((r) => r.id)),
  ]);
}

function pricing(pack, metrics) {
  const rows = metricsByKey(metrics, ["gross_margin", "operating_margin", "net_margin"]);
  if (!rows.length) {
    return insufficient("No margin metrics are present to discuss pricing power.");
  }
  return supported([
    claim(
      `Pricing-power language is restricted to reported margins: ${rows.map(formatItem).join("; ")}. The pack does not include a pricing-power rating.`,
      rows.map((r) => r.id),
    ),
  ]);
}

function growth(pack, metrics) {
  const keys = ["revenue_growth_1y", "revenue_growth"];
  if (moduleOf(pack) === "biopharma") {
    keys.push("ex_covid_operational_growth", "launched_acquired_products_growth", "pipeline_replacement_evidence");
  }
  const rows = metricsByKey(metrics, keys).concat(
    metrics.filter((item) => /growth/i.test(item.metric_key ?? "") && !SOFTWARE_FCF_KEYS.has(item.metric_key)),
  );
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
  if (!unique.length) {
    return insufficient("No growth metric is present in the evidence pack.");
  }
  return supported([
    claim(`Growth evidence: ${unique.map(formatItem).join("; ")}.`, unique.map((r) => r.id)),
  ]);
}

function risks(pack, metrics, docs) {
  const rows = [];
  const module = moduleOf(pack);
  if (module === "biopharma") {
    rows.push(
      ...metricsByKey(metrics, [
        "patent_expiry_revenue_exposure",
        "top_product_revenue_concentration",
        "pipeline_replacement_evidence",
      ]),
    );
  }
  if (BANK_MODULES.has(module)) {
    rows.push(
      ...metrics.filter((item) => /credit|npl|provision|cet1|capital|loan_loss/i.test(item.metric_key ?? "")),
    );
  }
  rows.push(...metricsByKey(metrics, ["total_debt", "net_debt"]));
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
  const refs = unique.map((r) => r.id);
  if (docs[0]) refs.push(docs[0].id);
  if (!unique.length && !docs.length) {
    return insufficient("No risk-relevant metric or source document is present.");
  }
  const gapRows = gapItems(pack)
    .filter((gap) => gap.gap_kind === "missing_sector_metric")
    .slice(0, 6);
  const gapNote = gapRows.map((gap) => gap.metric_key ?? gap.label);
  refs.push(...gapRows.map((gap) => gap.id));
  const text = unique.length
    ? `Risk evidence in the pack: ${unique.map(formatItem).join("; ")}.`
    : `A source document is present (${docs[0].label}) but no risk metric is extracted.`;
  const extra = gapNote.length ? ` Missing sector metrics flagged by the pack: ${gapNote.join(", ")}.` : "";
  return supported([claim(text + extra, refs)]);
}

function aiOpportunity(pack) {
  const items = pack.evidence_items ?? [];
  const hits = items.filter((item) =>
    /\bai\b|artificial intelligence|machine learning|generative/i.test(
      `${item.label ?? ""} ${item.value_text ?? ""} ${item.source?.title ?? ""} ${item.source?.notes ?? ""} ${item.metric_key ?? ""}`,
    ),
  );
  if (!hits.length) {
    return insufficient("No evidence_item mentions AI, machine learning, or generative systems.");
  }
  return supported([
    claim(`AI-related text present in the pack: ${hits.map(formatItem).join("; ")}.`, hits.map((h) => h.id)),
  ]);
}

function management(pack, docs) {
  if (!docs.length) {
    return insufficient("No source_document evidence_item is available for management observations.");
  }
  return insufficient(
    `Source documents exist (${docs.map((d) => d.label).join(", ")}) but the pack contains no extracted management metric or commentary field. Filings are not treated as a completed management assessment.`,
  );
}

function capital(pack, metrics) {
  const rows = metrics.filter((item) =>
    /buyback|repurchase|dividend|dilution|shares_outstanding|issuance|capex|payout/i.test(
      `${item.metric_key} ${item.label ?? ""}`,
    ),
  );
  if (!rows.length) {
    return insufficient("No capital-allocation metric (buybacks, dividends, dilution, shares, capex) is in the pack.");
  }
  return supported([
    claim(`Capital-allocation evidence: ${rows.map(formatItem).join("; ")}.`, rows.map((r) => r.id)),
  ]);
}

function bull(pack, metrics) {
  const vals = valuations(pack);
  const bullRow = vals.find((item) => item.id === "valuation:bull_value" || /bull/i.test(item.label ?? ""));
  const baseRow = vals.find((item) => item.id === "valuation:base_value" || /base fair/i.test(item.label ?? ""));
  const growth = metricsByKey(metrics, ["revenue_growth_1y", "revenue_growth", "operating_margin"])[0];
  const refs = [bullRow?.id, baseRow?.id, growth?.id].filter(Boolean);
  if (!refs.length) {
    return insufficient("No valuation scenario or supporting operating metric is present for a bull case.");
  }
  const bits = [bullRow, baseRow, growth].filter(Boolean).map(formatItem);
  return supported([
    claim(
      `Bull case is restricted to supplied valuation/operating evidence: ${bits.join("; ")}. No new target price is calculated.`,
      refs,
    ),
  ]);
}

function bear(pack, metrics) {
  const vals = valuations(pack);
  const bearRow = vals.find((item) => item.id === "valuation:bear_value" || /bear/i.test(item.label ?? ""));
  const debt = metricsByKey(metrics, ["total_debt", "net_debt"])[0];
  const loe = metricsByKey(metrics, ["patent_expiry_revenue_exposure"])[0];
  const refs = [bearRow?.id, debt?.id, loe?.id].filter(Boolean);
  if (!refs.length) {
    return insufficient("No bear valuation or downside metric is present.");
  }
  return supported([
    claim(
      `Bear case is restricted to supplied evidence: ${[bearRow, debt, loe].filter(Boolean).map(formatItem).join("; ")}.`,
      refs,
    ),
  ]);
}

function unknowns(pack) {
  const cov = coverage(pack);
  const gaps = gapItems(pack);
  if (!cov.length && !gaps.length) {
    return insufficient("The pack lists no coverage or evidence-gap evidence_items.");
  }
  const gapText = gaps.length
    ? gaps
        .slice(0, 8)
        .map((g) => g.metric_key ?? g.field ?? g.label ?? g.gap_kind)
        .join(", ")
    : "none listed";
  const refs = [
    ...gaps.slice(0, 8).map((row) => row.id),
    ...cov.slice(0, 3).map((row) => row.id),
  ];
  return supported([
    claim(
      `Known evidence gaps: ${gapText}. Coverage percentages are included only where explicitly cited.`,
      refs,
    ),
  ]);
}

export function composeBaselineResearch(pack) {
  if (!pack || pack.contract_version !== "baseline-research-contract-v1") {
    throw new Error("composeBaselineResearch requires a Baseline Research Evidence Pack V1");
  }

  const metrics = usableMetrics(pack);
  const docs = sources(pack);
  const allMetrics = (pack.evidence_items ?? []).filter((item) => item.kind === "metric");

  const sections = {
    company_overview: companyOverview(pack, metrics, docs),
    revenue_model: revenueModel(pack, metrics, docs),
    customer_characteristics: customers(pack, metrics, docs),
    competitive_position: competitive(pack, metrics, docs),
    moat_evidence: moat(pack, metrics),
    pricing_power: pricing(pack, metrics),
    growth_drivers: growth(pack, metrics),
    major_risks: risks(pack, allMetrics, docs),
    ai_opportunities: aiOpportunity(pack),
    ai_disruption_risks: aiOpportunity(pack),
    management_observations: management(pack, docs),
    capital_allocation_observations: capital(pack, allMetrics),
    bull_thesis: bull(pack, metrics),
    bear_thesis: bear(pack, metrics),
    biggest_unknowns: unknowns(pack),
  };

  for (const key of BASELINE_QUALITATIVE_SECTIONS) {
    if (!sections[key]) sections[key] = insufficient(`Section ${key} was not produced.`);
  }

  return {
    output_version: BASELINE_COMPOSER_OUTPUT_VERSION,
    composer_version: BASELINE_RESEARCH_COMPOSER_VERSION,
    evidence_pack_hash: pack.evidence_pack_hash,
    company: { ticker: pack.company.ticker, company_name: pack.company.company_name ?? null },
    sections,
    evidence_gaps: pack.evidence_gaps ?? [],
  };
}
