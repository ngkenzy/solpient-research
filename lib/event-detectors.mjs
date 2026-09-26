// V1 event ingestion — deterministic real-world event detectors.
//
// Pure functions only: no I/O, no network, no LLM anywhere in this path.
// Every classification is a deterministic function of the input document
// text plus the 8-K item code, so the same filing always yields the same
// event. Methodology: group-b-event-materiality-v1 (Stage A records what
// these detectors decide).
//
// Detector catalog (each returns a classification object or null):
//   extractEightKItems(text)          — 8-K item codes present in a filing doc
//   guidanceDirectionFromText(text)  — raised|maintained|lowered|withdrawn|new|null
//   classifyManagementEvent(text)    — 8-K Item 5.02
//   classifyEightKItem(item, text)   — full per-item classification
//   classifyEightKDocument({text})   — all items in a document
//   detectShareCountEvent({prevShares, currShares, periodEnd})
//
// Confidence heuristic (0-100, deterministic):
//   base 88 for SEC 8-K primary documents (primary_regulatory source class)
//   +4 when the subtype was corroborated by keyword evidence (cap 95)
//   routine/not_material items (5.07, exhibits-only 9.01, keyword-less 8.01)
//     score 90 — we are confident they carry no thesis signal
//   share-count derivations score 75 (derived_calculation source class)

export const TAXONOMY_VERSION = "event-taxonomy-v1";

export const EVENT_CATEGORIES = [
  "financial",
  "guidance",
  "business",
  "competition",
  "capital_allocation",
  "management",
  "regulatory",
  "research",
];

// Legacy change-engine categories -> PRD §15 taxonomy keys. Single source of
// truth; also used by scripts/backfill-research-change-events.mjs.
export const LEGACY_CATEGORY_MAP = {
  market: "financial",
  valuation: "financial",
  return: "financial",
  consensus: "financial",
  financial: "financial",
  score: "financial",
  coverage: "financial",
  thesis: "research",
  filing: "research",
  research: "research",
};

export function mapLegacyCategory(category) {
  return LEGACY_CATEGORY_MAP[String(category ?? "").toLowerCase()] ?? null;
}

const WORD = (pattern) => new RegExp(pattern, "i");

const GUIDANCE_NOUN = "(?:guidance|outlook|forecast|expectations?)";
const NEAR = "[^.\\n]{0,80}";

const GUIDANCE_PATTERNS = [
  ["withdrawn", WORD(`(?:withdr(?:aw|ew)\\w*|suspend\\w*|rescind\\w*)\\s+${NEAR}${GUIDANCE_NOUN}`)],
  ["lowered", WORD(`(?:lower\\w*|reduc\\w*|cut\\w*|decreas\\w*|trim\\w*)\\s+${NEAR}${GUIDANCE_NOUN}`)],
  ["lowered", WORD(`${GUIDANCE_NOUN}${NEAR}(?:lower\\w*|reduc\\w*|cut\\w*|decreas\\w*)`)],
  ["raised", WORD(`(?:rais\\w*|increas\\w*|lift\\w*|boost\\w*|up\\w+\\s+to)\\s+${NEAR}${GUIDANCE_NOUN}`)],
  ["raised", WORD(`${GUIDANCE_NOUN}${NEAR}(?:rais\\w*|increas\\w*|lift\\w*|boost\\w*)`)],
  ["new", WORD(`(?:introduc\\w*|initiat\\w*|establish\\w*|provid\\w*\\s+(?:its\\s+)?first)\\s+${NEAR}${GUIDANCE_NOUN}`)],
  ["maintained", WORD(`(?:reaffirm\\w*|maintain\\w*|reiterat\\w*|unchanged|confirm\\w*)\\s+${NEAR}${GUIDANCE_NOUN}`)],
  ["maintained", WORD(`${GUIDANCE_NOUN}${NEAR}(?:reaffirm\\w*|maintain\\w*|reiterat\\w*|unchanged)`)],
];

export function guidanceDirectionFromText(text) {
  const body = String(text ?? "");
  for (const [direction, pattern] of GUIDANCE_PATTERNS) {
    const match = body.match(pattern);
    if (match) return { direction, matched: match[0].slice(0, 160) };
  }
  return { direction: null, matched: null };
}

const MGMT_ROLE_PATTERNS = [
  ["CEO", WORD("chief\\s+executive|\\bCEO\\b")],
  ["CFO", WORD("chief\\s+financial|\\bCFO\\b")],
  ["board", WORD("board\\s+of\\s+directors|\\bdirector\\b")],
];

const MGMT_DEPARTURE = WORD("departure|resign\\w*|retir\\w*|step\\w*\\s+down|terminat\\w*|leav\\w*|separat\\w*");
const MGMT_APPOINTMENT = WORD("appoint\\w*|elect\\w*|named?\\s+(?:as\\s+|to\\s+)|join\\w*|promot\\w*|succeed\\w*");

export function classifyManagementEvent(text) {
  const body = String(text ?? "");
  let role = "executive";
  for (const [name, pattern] of MGMT_ROLE_PATTERNS) {
    if (pattern.test(body)) { role = name; break; }
  }
  const isDeparture = MGMT_DEPARTURE.test(body);
  const isAppointment = MGMT_APPOINTMENT.test(body);
  // Departure wins on ambiguity: a departure disclosed alongside a successor
  // appointment is still a leadership change event.
  const action = isDeparture ? "departure" : isAppointment ? "appointment" : "change";
  const materiality = role === "CEO" || role === "CFO" ? "high" : "material";
  const decision_impact = action === "departure" ? "weakening" : "monitor";
  const direction = action === "departure" ? "down" : action === "appointment" ? "up" : "changed";
  return {
    category: "management",
    subtype: role === "executive" ? "material executive change" : role,
    action,
    role,
    materiality,
    decision_impact,
    direction,
    confidence: 90,
    label: `${role} ${action}`,
    summary: `${role} ${action} disclosed under 8-K Item 5.02.`,
  };
}

const REGULATORY_ACTOR = "(?:FDA|EMA|SEC|DOJ|FTC|department\\s+of\\s+justice|attorney\\s+general|grand\\s+jury|antitrust|regulatory|government)";

const REGULATORY_PATTERNS = [
  // Approval/rejection require a regulatory actor so that "the board approved
  // a dividend" does not misclassify as a regulatory approval.
  ["investigation", WORD(`subpoena|internal\\s+investigat\\w*|${REGULATORY_ACTOR}${NEAR}(?:investigat|inquir|probe)|(?:investigat|inquir|probe)${NEAR}${REGULATORY_ACTOR}`), "high", "weakening"],
  ["litigation", WORD("lawsuit|litigat\\w*|class\\s+action|settlement"), "high", "weakening"],
  ["approval", WORD(`${REGULATORY_ACTOR}${NEAR}(?:approv\\w*|clearance|authorization)|marketing\\s+authorization`), "high", "improving"],
  ["rejection", WORD(`${REGULATORY_ACTOR}${NEAR}(?:reject\\w*|denial|denied)|complete\\s+response\\s+letter`), "high", "weakening"],
  ["rule change", WORD("rule\\s+change|new\\s+regulation|regulatory\\s+change"), "material", "monitor"],
];

const CAPITAL_PATTERNS = [
  ["buyback", WORD("repurchase|buyback|share\\s+repurchase"), "notable", "improving"],
  ["dividend", WORD("dividend"), null, null], // direction decided below
  ["acquisition", WORD("acquisition|merger|acquir\\w*"), "material", "monitor"],
  ["divestiture", WORD("divest\\w*|spin[- ]off|sale\\s+of\\s+(?:the\\s+)?(?:business|division|unit|assets?)"), "material", "monitor"],
  ["debt issuance", WORD("debt\\s+(?:offering|issuance)|notes\\s+offering|credit\\s+facility|borrow\\w*"), "notable", "monitor"],
  ["debt repayment", WORD("debt\\s+(?:repay|reduc|retir)|repay\\w*\\s+.*debt|tender\\s+offer.*notes"), "notable", "improving"],
  ["dilution", WORD("(?:public\\s+)?offering\\s+of\\s+common|at[- ]the[- ]market|equity\\s+offering|follow[- ]on\\s+offering"), "material", "weakening"],
];

const DIVIDEND_RAISE = WORD(`(?:rais\\w*|increas\\w*|boost\\w*)\\s+${NEAR}dividend|dividend${NEAR}(?:rais\\w*|increas\\w*)`);
const DIVIDEND_CUT = WORD(`(?:cut\\w*|reduc\\w*|lower\\w*|omit\\w*|suspend\\w*|eliminat\\w*)\\s+${NEAR}dividend|dividend${NEAR}(?:cut\\w*|reduc\\w*|omit\\w*|suspend\\w*)`);

const COMPETITION_PATTERNS = [
  ["competing product", WORD("competitor.*(?:launch|introduc|announc)|competing\\s+product|rival.*product"), "material", "weakening"],
  ["new entrant", WORD("new\\s+entrant|market\\s+entry\\s+by"), "material", "weakening"],
  ["price changes", WORD("pric\\w+\\s+(?:pressure|competition|war)|competitive\\s+pric"), "notable", "weakening"],
  ["technological disruption", WORD("disrupt\\w+.*technolog|technolog\\w+.*disrupt|generative\\s+ai.*compet"), "material", "monitor"],
];

const BUSINESS_PATTERNS = [
  ["product launch", WORD("launch\\w*|introduc\\w+.*product|unveil\\w*|general\\s+availability"), "material", "improving"],
  ["major customer", WORD("definitive\\s+agreement|customer\\s+contract|contract\\s+award|master\\s+services|strategic\\s+partnership"), "material", "improving"],
  ["demand", WORD("demand\\s+(?:growth|strength|weakness|decline)|order\\s+(?:growth|decline|backlog)"), "notable", "monitor"],
  ["supply chain", WORD("supply\\s+chain|supply\\s+disruption|component\\s+shortage"), "notable", "monitor"],
  ["geographic expansion", WORD("expan\\w+.*(?:market|country|region)|new\\s+market\\s+entry"), "notable", "improving"],
  ["segment change", WORD("reportable\\s+segment|segment\\s+(?:reporting|realignment|restructur)"), "material", "monitor"],
];

function cascadeMatch(text, patterns) {
  const body = String(text ?? "");
  for (const [subtype, pattern, materiality, decision_impact] of patterns) {
    const match = body.match(pattern);
    if (match) {
      return { subtype, materiality, decision_impact, matched: match[0].slice(0, 160) };
    }
  }
  return null;
}

// 8-K item codes present in filing document text. SEC 8-K documents render
// items as "Item 1.01", "ITEM 5.02", etc.
export function extractEightKItems(text) {
  const body = String(text ?? "");
  const found = new Set();
  for (const match of body.matchAll(/item\s+(\d\.\d{2})/gi)) {
    found.add(match[1]);
  }
  return [...found].sort();
}

function baseClassification(overrides) {
  return {
    category: null,
    subtype: null,
    materiality: "notable",
    decision_impact: "monitor",
    direction: "changed",
    confidence: 88,
    label: null,
    summary: null,
    ...overrides,
  };
}

// Classify one 8-K item deterministically. Returns a classification object;
// materiality may be 'not_material' for explicitly-dismissed routine items.
export function classifyEightKItem(item, text, context = {}) {
  const code = String(item ?? "").trim();
  const label8k = `8-K Item ${code}`;
  const withKeywordBonus = (classification, keywordHit) => ({
    ...classification,
    confidence: keywordHit
      ? Math.min(95, classification.confidence + 4)
      : classification.confidence,
  });

  switch (code) {
    case "5.02": {
      const mgmt = classifyManagementEvent(text);
      return withKeywordBonus(baseClassification({
        category: mgmt.category,
        subtype: mgmt.subtype,
        materiality: mgmt.materiality,
        decision_impact: mgmt.decision_impact,
        direction: mgmt.direction,
        confidence: mgmt.confidence,
        label: `${label8k} — ${mgmt.label}`,
        summary: mgmt.summary,
        management_role: mgmt.role,
        management_action: mgmt.action,
      }), true);
    }

    case "2.02": {
      const guidance = guidanceDirectionFromText(text);
      if (guidance.direction) {
        const dirMeta = {
          raised: ["high", "improving", "up"],
          lowered: ["high", "weakening", "down"],
          withdrawn: ["high", "weakening", "down"],
          new: ["material", "monitor", "new"],
          maintained: ["notable", "neutral", "unchanged"],
        }[guidance.direction];
        return withKeywordBonus(baseClassification({
          category: "guidance",
          subtype: guidance.direction === "new" ? "new guidance" : guidance.direction,
          materiality: dirMeta[0],
          decision_impact: dirMeta[1],
          direction: dirMeta[2],
          label: `${label8k} — guidance ${guidance.direction}`,
          summary: `Management ${guidance.direction} guidance in the 8-K earnings release ("${guidance.matched}").`,
          guidance_direction: guidance.direction,
        }), true);
      }
      return baseClassification({
        category: "financial",
        subtype: "earnings results",
        materiality: "notable",
        decision_impact: "monitor",
        direction: "new",
        label: `${label8k} — results of operations`,
        summary:
          "8-K Item 2.02 earnings release with no detectable guidance change; " +
          "headline numbers are covered by the snapshot-diff engine.",
      });
    }

    case "1.01": {
      const capital = cascadeMatch(text, CAPITAL_PATTERNS);
      if (capital && ["acquisition", "divestiture"].includes(capital.subtype)) {
        return withKeywordBonus(baseClassification({
          category: "capital_allocation",
          subtype: capital.subtype,
          materiality: capital.materiality,
          decision_impact: capital.decision_impact,
          direction: "new",
          label: `${label8k} — ${capital.subtype} agreement`,
          summary: `Material definitive agreement indicating a ${capital.subtype} ("${capital.matched}").`,
        }), true);
      }
      if (capital && capital.subtype === "debt issuance") {
        return withKeywordBonus(baseClassification({
          category: "capital_allocation",
          subtype: "debt issuance",
          materiality: "notable",
          decision_impact: "monitor",
          direction: "new",
          label: `${label8k} — debt financing agreement`,
          summary: `Material agreement for debt financing ("${capital.matched}").`,
        }), true);
      }
      return baseClassification({
        category: "business",
        subtype: "major customer",
        materiality: "material",
        decision_impact: "monitor",
        direction: "new",
        label: `${label8k} — material definitive agreement`,
        summary: "Entry into a material definitive agreement (8-K Item 1.01).",
      });
    }

    case "1.02":
      return baseClassification({
        category: "business",
        subtype: "major customer",
        materiality: "material",
        decision_impact: "weakening",
        direction: "down",
        label: `${label8k} — material agreement terminated`,
        summary: "Termination of a material definitive agreement (8-K Item 1.02).",
      });

    case "1.03":
      return baseClassification({
        category: "financial",
        subtype: "liquidity",
        materiality: "high",
        decision_impact: "weakening",
        direction: "down",
        label: `${label8k} — bankruptcy or receivership`,
        summary: "Bankruptcy or receivership disclosure (8-K Item 1.03).",
      });

    case "2.01": {
      const capital = cascadeMatch(text, CAPITAL_PATTERNS);
      const subtype = capital && ["acquisition", "divestiture"].includes(capital.subtype)
        ? capital.subtype
        : "acquisition";
      return withKeywordBonus(baseClassification({
        category: "capital_allocation",
        subtype,
        materiality: "material",
        decision_impact: "monitor",
        direction: "new",
        label: `${label8k} — ${subtype} completed`,
        summary: `Completion of ${subtype === "acquisition" ? "an acquisition" : "a divestiture"} of assets (8-K Item 2.01).`,
      }), Boolean(capital));
    }

    case "2.03":
      return baseClassification({
        category: "capital_allocation",
        subtype: "debt issuance",
        materiality: "notable",
        decision_impact: "monitor",
        direction: "up",
        label: `${label8k} — direct financial obligation created`,
        summary: "Creation of a direct financial obligation or off-balance-sheet arrangement (8-K Item 2.03).",
      });

    case "3.02":
      return baseClassification({
        category: "capital_allocation",
        subtype: "dilution",
        materiality: "material",
        decision_impact: "weakening",
        direction: "up",
        label: `${label8k} — unregistered equity sale`,
        summary: "Unregistered sale of equity securities — potential dilution (8-K Item 3.02).",
      });

    case "7.01": {
      const business = cascadeMatch(text, BUSINESS_PATTERNS);
      if (business && business.subtype === "product launch") {
        return withKeywordBonus(baseClassification({
          category: "business",
          subtype: "product launch",
          materiality: "material",
          decision_impact: "improving",
          direction: "new",
          label: `${label8k} — product launch disclosed`,
          summary: `Product launch disclosed under Regulation FD ("${business.matched}").`,
        }), true);
      }
      return baseClassification({
        category: "business",
        subtype: "demand",
        materiality: "notable",
        decision_impact: "monitor",
        direction: "new",
        label: `${label8k} — Regulation FD disclosure`,
        summary: "Regulation FD disclosure with no specific thesis-relevant development detected (8-K Item 7.01).",
      });
    }

    case "8.01": {
      // Deterministic cascade: regulatory > guidance > management >
      // capital allocation > competition > business > explicit not_material.
      const regulatory = cascadeMatch(text, REGULATORY_PATTERNS);
      if (regulatory) {
        return withKeywordBonus(baseClassification({
          category: "regulatory",
          subtype: regulatory.subtype,
          materiality: regulatory.materiality,
          decision_impact: regulatory.decision_impact,
          direction: regulatory.decision_impact === "improving" ? "up" : "down",
          label: `${label8k} — ${regulatory.subtype}`,
          summary: `Regulatory development: ${regulatory.subtype} ("${regulatory.matched}").`,
        }), true);
      }
      const guidance = guidanceDirectionFromText(text);
      if (guidance.direction) {
        const dirMeta = {
          raised: ["high", "improving", "up"],
          lowered: ["high", "weakening", "down"],
          withdrawn: ["high", "weakening", "down"],
          new: ["material", "monitor", "new"],
          maintained: ["notable", "neutral", "unchanged"],
        }[guidance.direction];
        return withKeywordBonus(baseClassification({
          category: "guidance",
          subtype: guidance.direction === "new" ? "new guidance" : guidance.direction,
          materiality: dirMeta[0],
          decision_impact: dirMeta[1],
          direction: dirMeta[2],
          label: `${label8k} — guidance ${guidance.direction}`,
          summary: `Management ${guidance.direction} guidance ("${guidance.matched}").`,
          guidance_direction: guidance.direction,
        }), true);
      }
      if (MGMT_DEPARTURE.test(text) || MGMT_APPOINTMENT.test(text)) {
        const mgmt = classifyManagementEvent(text);
        return withKeywordBonus(baseClassification({
          category: mgmt.category,
          subtype: mgmt.subtype,
          materiality: mgmt.materiality,
          decision_impact: mgmt.decision_impact,
          direction: mgmt.direction,
          confidence: mgmt.confidence,
          label: `${label8k} — ${mgmt.label}`,
          summary: mgmt.summary,
          management_role: mgmt.role,
          management_action: mgmt.action,
        }), true);
      }
      const capital = cascadeMatch(text, CAPITAL_PATTERNS);
      if (capital) {
        if (capital.subtype === "dividend") {
          const dir = DIVIDEND_CUT.test(text)
            ? { materiality: "high", decision_impact: "weakening", direction: "down", what: "cut" }
            : DIVIDEND_RAISE.test(text)
              ? { materiality: "material", decision_impact: "improving", direction: "up", what: "raised" }
              : { materiality: "notable", decision_impact: "monitor", direction: "changed", what: "declared" };
          return withKeywordBonus(baseClassification({
            category: "capital_allocation",
            subtype: "dividend",
            materiality: dir.materiality,
            decision_impact: dir.decision_impact,
            direction: dir.direction,
            label: `${label8k} — dividend ${dir.what}`,
            summary: `Dividend ${dir.what} ("${capital.matched}").`,
          }), true);
        }
        return withKeywordBonus(baseClassification({
          category: "capital_allocation",
          subtype: capital.subtype,
          materiality: capital.materiality,
          decision_impact: capital.decision_impact,
          direction: capital.decision_impact === "improving" ? "up"
            : capital.decision_impact === "weakening" ? "down" : "new",
          label: `${label8k} — ${capital.subtype}`,
          summary: `Capital allocation development: ${capital.subtype} ("${capital.matched}").`,
        }), true);
      }
      const competition = cascadeMatch(text, COMPETITION_PATTERNS);
      if (competition) {
        return withKeywordBonus(baseClassification({
          category: "competition",
          subtype: competition.subtype,
          materiality: competition.materiality,
          decision_impact: competition.decision_impact,
          direction: "down",
          label: `${label8k} — ${competition.subtype}`,
          summary: `Competitive development: ${competition.subtype} ("${competition.matched}").`,
        }), true);
      }
      const business = cascadeMatch(text, BUSINESS_PATTERNS);
      if (business) {
        return withKeywordBonus(baseClassification({
          category: "business",
          subtype: business.subtype,
          materiality: business.materiality,
          decision_impact: business.decision_impact,
          direction: business.decision_impact === "improving" ? "up" : "new",
          label: `${label8k} — ${business.subtype}`,
          summary: `Business development: ${business.subtype} ("${business.matched}").`,
        }), true);
      }
      // Explicit not_material: reviewed, no thesis-relevant keywords.
      return baseClassification({
        category: "business",
        subtype: "other event",
        materiality: "not_material",
        decision_impact: "neutral",
        direction: "unchanged",
        confidence: 90,
        label: `${label8k} — other event (no thesis signal)`,
        summary:
          "8-K Item 8.01 with no detectable guidance, management, regulatory, " +
          "capital-allocation, competition, or business keywords; reviewed and dismissed.",
      });
    }

    case "5.07":
      return baseClassification({
        category: "business",
        subtype: "other event",
        materiality: "not_material",
        decision_impact: "neutral",
        direction: "unchanged",
        confidence: 90,
        label: `${label8k} — shareholder vote results`,
        summary: "Routine submission of matters to a shareholder vote (8-K Item 5.07); no thesis signal.",
      });

    case "9.01":
      // Handled at the document level: a filing with ONLY Item 9.01 produces
      // one exhibits-only not_material event. Never emitted per-item here.
      return null;

    default:
      return baseClassification({
        category: "business",
        subtype: "other event",
        materiality: "notable",
        decision_impact: "monitor",
        direction: "new",
        confidence: 65,
        label: `${label8k} — unclassified item`,
        summary: `8-K Item ${code} is not in the detector catalog; surfaced for review with low confidence.`,
      });
  }
}

// Classify every item in an 8-K document. Handles the exhibits-only case
// (Item 9.01 alone -> one not_material event, not per-item noise).
export function classifyEightKDocument({ text, formType = "8-K" } = {}) {
  const items = extractEightKItems(text);
  const substantive = items.filter((item) => item !== "9.01");
  if (substantive.length === 0 && items.includes("9.01")) {
    return [{
      item: "9.01",
      ...baseClassification({
        category: "business",
        subtype: "other event",
        materiality: "not_material",
        decision_impact: "neutral",
        direction: "unchanged",
        confidence: 90,
        label: `${formType} — exhibits only`,
        summary: `${formType} filing contains only Item 9.01 exhibits; no thesis signal. Reviewed and dismissed.`,
      }),
    }];
  }
  const out = [];
  for (const item of substantive) {
    const classification = classifyEightKItem(item, text);
    if (classification) out.push({ item, ...classification });
  }
  return out;
}

// Capital allocation from fundamentals: quarter-over-quarter shares
// outstanding delta. Deterministic thresholds; derived_calculation class.
export function detectShareCountEvent({ prevShares, currShares, periodEnd } = {}) {
  const prev = Number(prevShares);
  const curr = Number(currShares);
  if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev <= 0) return null;
  const delta = (curr - prev) / Math.abs(prev);
  if (delta <= -0.02) {
    return {
      category: "capital_allocation",
      subtype: "buyback",
      materiality: delta <= -0.05 ? "material" : "notable",
      decision_impact: "improving",
      direction: "down",
      confidence: 75,
      label: `Share count down ${(Math.abs(delta) * 100).toFixed(1)}%`,
      summary:
        `Shares outstanding fell ${(Math.abs(delta) * 100).toFixed(1)}% quarter over quarter ` +
        `(derived from SEC companyfacts), consistent with buyback activity.`,
      delta_percent: delta * 100,
      metric_key: "shares_outstanding",
      event_key: `shares:${periodEnd ?? "latest"}`,
    };
  }
  if (delta >= 0.02) {
    return {
      category: "capital_allocation",
      subtype: "dilution",
      materiality: delta >= 0.05 ? "material" : "notable",
      decision_impact: "weakening",
      direction: "up",
      confidence: 75,
      label: `Share count up ${(delta * 100).toFixed(1)}%`,
      summary:
        `Shares outstanding rose ${(delta * 100).toFixed(1)}% quarter over quarter ` +
        `(derived from SEC companyfacts), consistent with dilution.`,
      delta_percent: delta * 100,
      metric_key: "shares_outstanding",
      event_key: `shares:${periodEnd ?? "latest"}`,
    };
  }
  return null;
}

// Normalized-fact lookup patterns per taxonomy category, used to populate
// affected_fact_id deterministically (latest known fact wins; null when none).
export const AFFECTED_FACT_PATTERNS = {
  guidance: ["%guidance%"],
  capital_allocation: ["%share%", "%dividend%", "%debt%"],
  business: ["%revenue%", "%contract%"],
  competition: ["%market%share%"],
  financial: ["%revenue%", "%fcf%", "%eps%"],
  management: [],
  regulatory: [],
  research: [],
};
