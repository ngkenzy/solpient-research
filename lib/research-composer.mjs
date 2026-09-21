export const RESEARCH_COMPOSER_VERSION = "composer-v1";

function n(v) {
  if(v===null||v===undefined||(typeof v==="string"&&v.trim()==="")) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
function pct(v, digits = 1) {
  return v == null ? "not available" : Number(v).toFixed(digits) + "%";
}
function money(v) {
  if (v == null) return "not available";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(v);
}
function median(values) {
  const xs = values.map(n).filter((x) => x != null).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}
function annualized(start, end, years) {
  const a = n(start), b = n(end);
  if (a == null || b == null || a <= 0 || b <= 0 || years <= 0) return null;
  return (Math.pow(b / a, 1 / years) - 1) * 100;
}
function metricObservation(payload,key,module="universal") {
  const rows=Array.isArray(payload?.metric_observations)?payload.metric_observations:[];
  return rows.find((r)=>(r.module??"universal")===module&&r.metric_key===key&&r.status==="available") ?? null;
}
function latestMetric(payload, key) {
  const row=metricObservation(payload,key,"universal");
  return row ? n(row.value_numeric) : null;
}
function industryMetric(payload,module,key) {
  const row=module?metricObservation(payload,key,module):null;
  return row ? n(row.value_numeric) : null;
}
function industryMetricText(payload,module,key) {
  const row=module?metricObservation(payload,key,module):null;
  return row?.value_text ?? null;
}
function deriveScore({ growth, margin, fcfMargin, debt, cash, fcfYield }) {
  let score = 50;
  if (growth != null) score += clamp(growth, -20, 30) * 0.7;
  if (margin != null) score += clamp(margin - 10, -20, 40) * 0.45;
  if (fcfMargin != null) score += clamp(fcfMargin - 10, -20, 40) * 0.55;
  if (debt != null && cash != null) score += debt <= cash ? 6 : -4;
  if (fcfYield != null) score += clamp(fcfYield - 3, -5, 12) * 1.2;
  return Math.round(clamp(score, 0, 100));
}
function moatScoreFromRating(value){
  const rating=String(value??"").toLowerCase();
  if(["exceptional","wide"].includes(rating))return 85;
  if(["strong"].includes(rating))return 75;
  if(["moderate","average"].includes(rating))return 60;
  if(["narrow"].includes(rating))return 55;
  if(["weak","limited"].includes(rating))return 35;
  return null;
}
function qualityLabel(score) {
  if (score >= 85) return "exceptional";
  if (score >= 70) return "strong";
  if (score >= 55) return "average";
  return "weak";
}
function riskLabel(score) {
  if (score >= 80) return "low";
  if (score >= 60) return "moderate";
  return "high";
}
function ratingFromUpside(upside) {
  if (upside == null) return "insufficient_data";
  if (upside >= 30) return "undervalued";
  if (upside >= 10) return "modestly_undervalued";
  if (upside > -10) return "fairly_valued";
  if (upside > -25) return "overvalued";
  return "significantly_overvalued";
}
function trendText(name, value) {
  if (value == null) return name + " trend is not yet supported by enough history.";
  if (value >= 12) return name + " has compounded strongly at roughly " + pct(value) + " annually.";
  if (value >= 5) return name + " has compounded at a healthy " + pct(value) + " annual rate.";
  if (value >= 0) return name + " has grown slowly at roughly " + pct(value) + " annually.";
  return name + " has contracted at roughly " + pct(value) + " annually.";
}
function dcfPerShare({ fcfPerShare, growth, discountRate, terminalGrowth }) {
  const f = n(fcfPerShare), g = n(growth), r = n(discountRate), tg = n(terminalGrowth);
  if (f == null || f <= 0 || g == null || r == null || tg == null || r <= tg) return null;
  let pv = 0, next = f;
  for (let year = 1; year <= 5; year++) {
    next *= 1 + g / 100;
    pv += next / Math.pow(1 + r / 100, year);
  }
  const terminal = next * (1 + tg / 100) / ((r - tg) / 100);
  return pv + terminal / Math.pow(1 + r / 100, 5);
}
function horizonStats(rows, asOfDate, years) {
  const cutoff = new Date(asOfDate);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  const eligible = rows.filter((r) => new Date(r.trading_date) >= cutoff);
  const key = eligible.some((r) => n(r.price_to_fcf) != null) ? "price_to_fcf" : "pe";
  const valid=eligible
    .map((r)=>({date:new Date(r.trading_date),value:n(r[key])}))
    .filter((r)=>Number.isFinite(r.date.getTime())&&r.value!=null&&r.value>0&&r.value<200)
    .sort((a,b)=>a.date-b.date);
  const values=valid.map((r)=>r.value);
  const coverageYears=valid.length>=2?(valid.at(-1).date-valid[0].date)/(365.25*24*60*60*1000):0;
  const available=values.length>=40&&coverageYears>=Math.min(years,years*0.8);
  return { years, metric:key, median:median(values), observations:values.length, coverageYears, available };
}
function nearestPeerMedian(context, metric) {
  const peers = Array.isArray(context?.peer_comparison) ? context.peer_comparison : [];
  return median(peers.map((p) => p?.metrics?.[metric]).filter((v) => n(v) != null));
}
function choosePerShare(payload,industryModule) {
  const adjustedEps=industryModule==="biopharma"?industryMetric(payload,industryModule,"adjusted_eps_guidance_midpoint"):null;
  const fcf = latestMetric(payload, "fcf_per_share");
  const eps = latestMetric(payload, "eps_diluted") ?? n(payload?.financial_metrics?.eps);
  if(adjustedEps!=null&&adjustedEps>0)return{metric:"forward_pe",perShare:adjustedEps,label:"adjusted EPS guidance midpoint",normalized:true};
  return fcf != null && fcf > 0 ? { metric: "price_to_fcf", perShare: fcf, label: "FCF/share" } :
    eps != null && eps > 0 ? { metric: "pe", perShare: eps, label: "EPS" } :
    { metric: null, perShare: null, label: "per-share earnings/cash flow" };
}
function scenarioValues({ perShare, history, peerMedian, growthBase, valuationMetric }) {
  if (perShare == null) return { bear: null, base: null, bull: null, method: null };
  const historyMeds = history.filter((h)=>h.available&&h.metric===valuationMetric).map((h) => h.median).filter((x) => x != null);
  const anchor = median([...historyMeds, peerMedian].filter((x) => x != null));
  if (anchor == null) return { bear: null, base: null, bull: null, method: null };
  const growthAdj = growthBase == null ? 1 : clamp(1 + growthBase / 100 * 0.35, 0.75, 1.35);
  return {
    bear: perShare * anchor * 0.75,
    base: perShare * anchor * growthAdj,
    bull: perShare * anchor * 1.3 * growthAdj,
    method: "normalized_multiple"
  };
}
function createReturnScenarios(currentPrice, values, annualDividend=0) {
  const out = [];
  for (const [scenario, terminal] of [["bear", values.bear], ["base", values.base], ["bull", values.bull]]) {
    for (const horizon of [3, 5, 10]) {
      const dividends=currentPrice!=null&&annualDividend>0?annualDividend*horizon:0;
      const terminalWithDividends=terminal==null?null:terminal+dividends;
      out.push({
        scenario,
        horizon_years: horizon,
        expected_cagr: annualized(currentPrice, terminalWithDividends, horizon),
        terminal_value: terminal,
        return_decomposition: {
          starting_price: currentPrice,
          ending_value: terminal,
          dividends_assumed: dividends,
          annual_dividend_per_share: annualDividend || 0,
          note: annualDividend>0
            ? "CAGR includes flat cash dividends without reinvestment; dividend growth/cuts are not forecast."
            : "Price-only CAGR because no normalized dividend assumption is available."
        }
      });
    }
  }
  return out;
}

export function composeResearchV1({ company, baselinePayload, contextPack = {}, valuationHistory = [], asOfDate = new Date().toISOString().slice(0, 10) }) {
  const payload = baselinePayload ?? {};
  const research = payload.research ?? {};
  const industryModule=Array.isArray(research.industry_modules)?research.industry_modules[0]??null:null;
  const isBiopharma=industryModule==="biopharma";
  const currentPrice = n(research.price_at_research);
  const reportedMarketCap = n(research.market_cap);
  const sharesOutstanding = latestMetric(payload, "shares_outstanding") ?? n(payload?.financial_metrics?.shares_outstanding);
  const marketCap = reportedMarketCap != null && reportedMarketCap > 0
    ? reportedMarketCap
    : currentPrice != null && sharesOutstanding != null && sharesOutstanding > 0
      ? currentPrice * sharesOutstanding
      : reportedMarketCap;
  const revenueGrowth = latestMetric(payload, "revenue_growth_1y") ?? n(payload?.financial_metrics?.revenue_growth_1y);
  const grossMargin = latestMetric(payload, "gross_margin") ?? n(payload?.financial_metrics?.gross_margin);
  const opMargin = latestMetric(payload, "operating_margin") ?? n(payload?.financial_metrics?.operating_margin);
  const netMargin = latestMetric(payload, "net_margin") ?? n(payload?.financial_metrics?.net_margin);
  const fcfMargin = latestMetric(payload, "fcf_margin") ?? n(payload?.financial_metrics?.fcf_margin);
  const fcfYield = latestMetric(payload, "fcf_yield") ?? n(payload?.financial_metrics?.fcf_yield);
  const cash = latestMetric(payload, "cash") ?? n(payload?.financial_metrics?.cash);
  const debt = latestMetric(payload, "total_debt") ?? n(payload?.financial_metrics?.total_debt);
  const reportedEnterpriseValue = n(research.enterprise_value);
  const enterpriseValue = reportedEnterpriseValue != null
    ? reportedEnterpriseValue
    : marketCap != null && cash != null && debt != null
      ? marketCap + debt - cash
      : null;
  const growth5 = n(contextPack?.trends?.revenue_cagr);
  const fcfGrowth5 = n(contextPack?.trends?.fcf_per_share_cagr ?? contextPack?.trends?.fcf_cagr);
  const shareGrowth = n(contextPack?.trends?.share_count_cagr);
  const quantitativeQuality = deriveScore({ growth: revenueGrowth ?? growth5, margin: opMargin, fcfMargin, debt, cash, fcfYield });
  const quality = qualityLabel(quantitativeQuality);
  const risk = riskLabel(quantitativeQuality);

  const asOf = asOfDate;
  const hist = [3, 5, 10].map((years) => horizonStats(valuationHistory, asOf, years));
  const valuationGrowth=isBiopharma
    ? (industryMetric(payload,industryModule,"ex_covid_operational_growth") ?? growth5 ?? revenueGrowth)
    : (fcfGrowth5 ?? growth5 ?? revenueGrowth);
  const perShare = choosePerShare(payload,industryModule);
  const peerMultiple = perShare.metric ? nearestPeerMedian(contextPack, perShare.metric) : null;
  const fcfPerShareForPeer=latestMetric(payload,"fcf_per_share");
  const peerFcfMultiple=nearestPeerMedian(contextPack,"price_to_fcf");
  const normalizedPeerValue=fcfPerShareForPeer!=null&&peerFcfMultiple!=null
    ? fcfPerShareForPeer*peerFcfMultiple
    : null;
  const multipleCases = scenarioValues({ perShare: perShare.perShare, history: hist, peerMedian: peerMultiple, growthBase: valuationGrowth, valuationMetric:perShare.metric });

  const dcfBear = dcfPerShare({ fcfPerShare: latestMetric(payload, "fcf_per_share"), growth: clamp((fcfGrowth5 ?? revenueGrowth ?? 4) * 0.5, -5, 6), discountRate: 11.5, terminalGrowth: 2 });
  const dcfBase = dcfPerShare({ fcfPerShare: latestMetric(payload, "fcf_per_share"), growth: clamp(fcfGrowth5 ?? revenueGrowth ?? 6, 2, 10), discountRate: 10, terminalGrowth: 2.5 });
  const dcfBull = dcfPerShare({ fcfPerShare: latestMetric(payload, "fcf_per_share"), growth: clamp((fcfGrowth5 ?? revenueGrowth ?? 8) * 1.15, 5, 14), discountRate: 9, terminalGrowth: 3 });

  const bearValue = median([multipleCases.bear, dcfBear, normalizedPeerValue==null?null:normalizedPeerValue*0.75].filter((x) => x != null));
  const baseValue = median([multipleCases.base, dcfBase, normalizedPeerValue].filter((x) => x != null));
  const bullValue = median([multipleCases.bull, dcfBull, normalizedPeerValue==null?null:normalizedPeerValue*1.25].filter((x) => x != null));
  const upside = currentPrice != null && baseValue != null ? (baseValue / currentPrice - 1) * 100 : null;

  const peerNames = (contextPack?.peer_set ?? []).map((p) => p.ticker).slice(0, 6);
  const peerCoverage = Number(contextPack?.summary?.peers_with_local_data ?? 0);
  const yearsCovered = Number(contextPack?.history_coverage?.full_year_count ?? contextPack?.summary?.full_fiscal_years ?? 0);
  const adjustedEpsGuidance=industryMetric(payload,industryModule,"adjusted_eps_guidance_midpoint");
  const loeExposure=industryMetric(payload,industryModule,"patent_expiry_revenue_exposure");
  const productConcentration=industryMetric(payload,industryModule,"top_product_revenue_concentration");
  const pipelineLateStage=industryMetric(payload,industryModule,"pipeline_replacement_evidence");
  const pipelineEvidence=industryMetricText(payload,industryModule,"pipeline_replacement_evidence");
  const exCovidGrowth=industryMetric(payload,industryModule,"ex_covid_operational_growth");
  const launchedGrowth=industryMetric(payload,industryModule,"launched_acquired_products_growth");
  const annualDividend=industryMetric(payload,industryModule,"annualized_dividend_per_share") ?? 0;
  const normalizedGrowth=isBiopharma?(exCovidGrowth ?? growth5 ?? revenueGrowth):(growth5 ?? revenueGrowth);
  const normalizedEarningsYield=currentPrice!=null&&adjustedEpsGuidance!=null&&currentPrice>0?adjustedEpsGuidance/currentPrice*100:null;

  const existingBusiness = payload.business_assessment ?? {};
  const description = company?.description ?? payload.description ?? "Business description is not normalized.";
  const recurring = existingBusiness.revenue_model || "Revenue-model detail requires analyst review; the composer does not infer recurrence from sector labels alone.";
  const moat = existingBusiness.moat_rating || "provisional";
  const moatNote = existingBusiness.moat_rating
    ? "Carries forward the baseline moat assessment for human review."
    : "No verified qualitative moat assessment is available; this remains provisional.";

  const historyRows = hist.reduce((acc, h) => {
    acc[h.years + "y"] = h.available && h.median != null
      ? { status: "available", metric: h.metric, median_multiple: h.median, observations: h.observations, coverage_years:Math.round(h.coverageYears*10)/10, explanation: "Median " + h.metric.replaceAll("_", " ") + " from stored point-in-time valuation history." }
      : { status: "unavailable", metric: h.metric, median_multiple: h.median, observations: h.observations, coverage_years:Math.round(h.coverageYears*10)/10, explanation: "Stored valuation history covers only " + h.coverageYears.toFixed(1) + " years; it is not deep enough for a reliable " + h.years + "-year comparison." };
    return acc;
  }, {});

  const scorecard = [
    ...(isBiopharma?[
      ["Adjusted EPS guidance midpoint",adjustedEpsGuidance,"Company guidance is a better normalized earnings anchor than a quarter distorted by impairment charges."],
      ["2026 LOE revenue impact",loeExposure,"Patent and exclusivity losses are a core revenue-replacement hurdle for biopharma."],
      ["Top product concentration",productConcentration,"Product concentration raises patent, pricing and clinical-event sensitivity."],
      ["Late-stage / registration pipeline",pipelineLateStage,"Pipeline breadth is capacity evidence, not a probability-adjusted revenue forecast."]
    ]:[]),
    ["Revenue growth", revenueGrowth, "Growth must be interpreted against company history and peers."],
    ["Gross margin", grossMargin, "High margins can support pricing power but are not a moat by themselves."],
    ["Operating margin", opMargin, "Tracks operating efficiency and reinvestment burden."],
    ["Net margin", netMargin, "Measures bottom-line profitability after the full cost structure."],
    ["FCF margin", fcfMargin, "Measures cash conversion of revenue."],
    ["FCF yield", fcfYield, "Higher yield improves starting valuation, subject to cash-flow durability."],
    ["Net cash / debt", cash != null && debt != null ? cash - debt : null, "Balance-sheet flexibility affects downside protection."],
    ["Share count CAGR", shareGrowth, "Negative values indicate net shrinkage; positive values indicate dilution."],
    ["Revenue CAGR", growth5, "Multi-year growth is more informative than one reporting period."],
    ["FCF/share CAGR", fcfGrowth5, "Per-share cash compounding matters more than aggregate growth."]
  ].map(([metric, value, assessment]) => ({ metric, current_value: value, assessment }));

  const risks = [
    ...(isBiopharma?[
      {
        risk:"Patent / exclusivity cliff",
        probability:"high",
        severity:"high",
        evidence:"Company-estimated 2026 LOE revenue impact: "+money(loeExposure)+".",
        thesis_breaker:"Loss-of-exclusivity erosion materially outruns launched-product and pipeline revenue replacement through the 2026-2030 cliff."
      },
      {
        risk:"Pipeline replacement",
        probability:"moderate",
        severity:"high",
        evidence:pipelineEvidence ?? ("Late-stage/registration programs: "+(pipelineLateStage??"not available")+"."),
        thesis_breaker:"Late-stage assets fail clinically, commercially or on timing such that replacement revenue is insufficient before major product erosion."
      }
    ]:[]),
    {
      risk: "Growth durability",
      probability: revenueGrowth != null && revenueGrowth < 5 ? "elevated" : "moderate",
      severity: "high",
      evidence: "Current revenue growth: " + pct(revenueGrowth) + "; multi-year revenue CAGR: " + pct(growth5) + ".",
      thesis_breaker: "Revenue and per-share cash-flow growth remain structurally below the assumptions supporting base-case fair value for multiple reporting periods."
    },
    {
      risk: "Margin compression",
      probability: opMargin != null && opMargin < 10 ? "elevated" : "moderate",
      severity: "high",
      evidence: "Operating margin: " + pct(opMargin) + "; FCF margin: " + pct(fcfMargin) + ".",
      thesis_breaker: "Normalized operating and free-cash-flow margins reset materially lower without a credible high-return reinvestment explanation."
    },
    {
      risk: "Valuation error",
      probability: "moderate",
      severity: "high",
      evidence: "Base fair value is derived from stored history, peers and a simplified cash-flow model rather than a market forecast.",
      thesis_breaker: "The normalized earnings/cash-flow base or defensible multiple is materially lower than the assumptions used in the base case."
    },
    {
      risk: "Capital allocation / dilution",
      probability: shareGrowth != null && shareGrowth > 2 ? "elevated" : "moderate",
      severity: "moderate",
      evidence: "Share-count CAGR: " + pct(shareGrowth) + ".",
      thesis_breaker: "Per-share value creation is persistently offset by dilution, poor acquisitions, or value-destructive repurchases."
    }
  ];

  const thesisVariables = [
    ...(isBiopharma?[
      {
        variable_name:"LOE replacement",
        expectation:"Launched/acquired products and pipeline conversions should offset the patent/exclusivity revenue cliff.",
        observed_value:"2026 LOE impact "+money(loeExposure)+"; launched/acquired product operational growth "+pct(launchedGrowth)+".",
        status:"monitor",metric_key:"patent_expiry_revenue_exposure",review_frequency:"quarterly",
        breaker_condition:"LOE erosion persistently exceeds replacement growth and pushes normalized revenue/earnings below the base-case path."
      },
      {
        variable_name:"Pipeline conversion",
        expectation:"Late-stage programs should convert into approvals and commercially material products before the LOE wave peaks.",
        observed_value:pipelineEvidence ?? "Pipeline replacement evidence is incomplete.",
        status:"monitor",metric_key:"pipeline_replacement_evidence",review_frequency:"quarterly",
        breaker_condition:"Clinical/regulatory setbacks materially reduce late-stage replacement capacity or push key launches beyond the LOE window."
      }
    ]:[]),
    {
      variable_name: "Durable growth",
      expectation: "Revenue and per-share cash flow should compound at rates consistent with the valuation.",
      observed_value: "Revenue growth " + pct(revenueGrowth) + "; FCF/share CAGR " + pct(fcfGrowth5) + ".",
      status: "monitor",
      metric_key: "revenue_growth_1y",
      review_frequency: "quarterly",
      breaker_condition: "Revenue growth and FCF/share growth remain below 5% for multiple periods without a credible cyclical explanation."
    },
    {
      variable_name: "Cash economics",
      expectation: "Free cash flow should remain durable relative to revenue.",
      observed_value: "FCF margin " + pct(fcfMargin) + ".",
      status: "monitor",
      metric_key: "fcf_margin",
      review_frequency: "quarterly",
      breaker_condition: "Normalized FCF margin falls materially below the level required by the base valuation and fails to recover."
    },
    {
      variable_name: "Per-share compounding",
      expectation: "Growth should accrue to owners after dilution and capital allocation.",
      observed_value: "Share-count CAGR " + pct(shareGrowth) + ".",
      status: "monitor",
      metric_key: "shares_outstanding",
      review_frequency: "annual",
      breaker_condition: "Share dilution or poor capital allocation causes per-share cash flow to materially trail enterprise growth."
    }
  ];

  const expectedReturns = createReturnScenarios(currentPrice, { bear: bearValue, base: baseValue, bull: bullValue },annualDividend);

  const businessAssessment = {
    business_quality_rating: existingBusiness.business_quality_rating || (isBiopharma?"provisional — biopharma evidence review required":quality),
    moat_rating: moat,
    pricing_power: existingBusiness.pricing_power || "provisional; requires product/customer evidence",
    revenue_model: recurring,
    recurring_revenue_pct: existingBusiness.recurring_revenue_pct ?? null,
    customer_concentration: existingBusiness.customer_concentration || "not normalized; requires filing review",
    geographic_exposure: existingBusiness.geographic_exposure || "not normalized; requires filing review",
    market_position: existingBusiness.market_position || "provisional; peer set configured: " + (peerNames.join(", ") || "none"),
    growth_runway: existingBusiness.growth_runway || "Quantitative runway is supported only to the extent recent and multi-year growth remain durable.",
    cyclicality: existingBusiness.cyclicality || "requires analyst review",
    capital_intensity: existingBusiness.capital_intensity || "requires analyst review",
    ai_opportunity: existingBusiness.ai_opportunity || "requires company-specific evidence; no generic AI benefit is assumed",
    ai_threat: existingBusiness.ai_threat || "requires company-specific evidence; no generic AI disruption claim is assumed",
    management_quality: existingBusiness.management_quality || "unreviewed; the composer does not infer management quality from financial outcomes alone",
    capital_allocation_assessment: existingBusiness.capital_allocation_assessment || ("Share-count CAGR is " + pct(shareGrowth) + "; qualitative capital-allocation judgment remains unreviewed."),
    bull_thesis: existingBusiness.bull_thesis || "Growth, margins and per-share cash generation remain durable while the starting valuation allows attractive compounding.",
    bear_thesis: existingBusiness.bear_thesis || "Growth or margins structurally reset lower, qualitative competitive advantages prove weaker than assumed, or valuation support disappears.",
    capital_allocation_test: existingBusiness.capital_allocation_test || "Active ownership is only justified if expected base-case returns exceed the index alternative after accounting for greater company-specific risk.",
    biggest_unknown: existingBusiness.biggest_unknown || "The largest unresolved issue is qualitative: whether the business can sustain its economics and competitive position through the next industry cycle.",
    evidence_note: moatNote
  };

  return {
    composer: {
      version: RESEARCH_COMPOSER_VERSION,
      generated_at: new Date().toISOString(),
      as_of_date: asOf,
      status: "private_draft",
      human_review_required: true,
      publication_allowed: false,
      input_history_years: yearsCovered,
      peer_data_count: peerCoverage,
      limitations: [
        "Qualitative moat, management and competitive claims are never invented from sector labels.",
        "Valuation is a model output, not a price forecast.",
        "Missing history or peer data remains explicit rather than silently imputed."
      ]
    },
    review_patch: {
      research: {
        summary: isBiopharma
          ? (company?.ticker ?? payload.ticker)+" biopharma research draft: current YoY revenue growth "+pct(revenueGrowth)+", 2026 adjusted EPS guidance midpoint "+money(adjustedEpsGuidance)+", top-product concentration "+pct(productConcentration)+", 2026 LOE impact "+money(loeExposure)+", and "+(pipelineLateStage??"unquantified")+" late-stage/registration pipeline programs. Valuation remains provisional until decision-grade peer and historical context pass."
          : (company?.ticker ?? payload.ticker) + " automated research draft: " + quality + " quantitative business quality, " + ratingFromUpside(upside).replaceAll("_", " ") + " base valuation, and human review required before publication.",
        standard_version: "solpient-v2",
        benchmark_ticker: research.benchmark_ticker || "SPY",
        data_cutoff_at: research.data_cutoff_at || new Date().toISOString()
      },
      investment_thesis: {
        governing_question: "Does this company offer a sufficiently attractive combination of business quality, valuation, expected return, and downside protection to justify owning it instead of a broad-market index?",
        business_description: description,
        quantitative_case: isBiopharma
          ? "Reported Q2 revenue growth is "+pct(revenueGrowth)+"; revenue excluding COVID products grew "+pct(exCovidGrowth)+" operationally; launched/acquired products grew "+pct(launchedGrowth)+"; adjusted EPS guidance midpoint is "+money(adjustedEpsGuidance)+"; annualized dividend is "+money(annualDividend)+"."
          : "Revenue growth is " + pct(revenueGrowth) + ", operating margin is " + pct(opMargin) + ", and FCF margin is " + pct(fcfMargin) + ".",
        what_must_be_true: isBiopharma
          ? "Launched products and pipeline conversion must replace the 2026-2030 loss-of-exclusivity erosion while normalized earnings cover the dividend and debt declines without starving high-return R&D."
          : "The business must preserve durable growth, margins and per-share cash generation while avoiding material competitive or capital-allocation impairment.",
        bull_thesis: businessAssessment.bull_thesis,
        bear_thesis: businessAssessment.bear_thesis
      },
      business_assessment: businessAssessment,
      financial_quality: {
        history_years: yearsCovered,
        history_limitation: yearsCovered >= 5 ? null : "Stored normalized history currently covers fewer than five complete fiscal years.",
        improving_trends: [
          growth5 != null && growth5 > 0 ? trendText("Revenue", growth5) : null,
          fcfGrowth5 != null && fcfGrowth5 > 0 ? trendText("FCF/share", fcfGrowth5) : null,
          shareGrowth != null && shareGrowth < 0 ? "Share count has declined at roughly " + pct(Math.abs(shareGrowth)) + " annually." : null
        ].filter(Boolean),
        deteriorating_trends: [
          growth5 != null && growth5 < 0 ? trendText("Revenue", growth5) : null,
          fcfGrowth5 != null && fcfGrowth5 < 0 ? trendText("FCF/share", fcfGrowth5) : null,
          shareGrowth != null && shareGrowth > 2 ? "Share count has increased at roughly " + pct(shareGrowth) + " annually." : null
        ].filter(Boolean),
        narrative: isBiopharma
          ? "Generic financial quality score is "+quantitativeQuality+"/100, but Pfizer's decision-grade assessment uses adjusted EPS guidance, patent/LOE exposure, product concentration, pipeline replacement and dividend/debt capacity because GAAP earnings can be distorted by acquisition and impairment charges."
          : "Quantitative quality score is " + quantitativeQuality + "/100. " + trendText("Revenue", growth5) + " " + trendText("FCF/share", fcfGrowth5)
      },
      fundamental_scorecard: scorecard,
      competitive_position: {
        peers: peerNames,
        peer_data_count: peerCoverage,
        peer_limitation: peerCoverage >= 2 ? null : "Fewer than two configured peers currently have local normalized data.",
        relative_assessment: peerCoverage ? "Peer comparisons use only locally ingested normalized metrics; qualitative competitive conclusions remain subject to review." : "Peer data is not yet sufficient for a comparative conclusion."
      },
      valuation_analysis: {
        methods: [
          { method: "dcf", status: dcfBase != null ? "applied" : "unavailable", reason: dcfBase != null ? "Simplified per-share FCF DCF with explicit growth, discount-rate and terminal assumptions." : "Normalized positive FCF/share is unavailable." },
          { method: "owner_earnings", status: dcfBase != null ? "applied" : "unavailable", reason: dcfBase != null ? "FCF/share is used as a conservative owner-earnings proxy for v1." : "Owner-earnings proxy is unavailable." },
          { method: "earnings_or_fcf_multiple", status: multipleCases.base != null ? "applied" : "unavailable", reason: multipleCases.base != null ? "Uses normalized per-share cash flow or earnings and stored valuation anchors." : "No defensible per-share base or multiple anchor is available." },
          { method: "historical_valuation", status: hist.some((h) => h.available&&h.median != null) ? "applied" : "unavailable", reason: hist.some((h) => h.available&&h.median != null) ? "Uses medians from sufficiently deep stored valuation history." : "Historical valuation depth is insufficient; short samples are not treated as multi-year history." },
          { method: "peer_valuation", status: (peerMultiple != null || normalizedPeerValue != null) ? "applied" : "unavailable", reason: peerMultiple != null
            ? "Uses the median normalized peer multiple matching the primary per-share valuation metric."
            : normalizedPeerValue != null
              ? "Uses median peer price/FCF applied to normalized PFE FCF/share because forward P/E was unavailable."
              : "Peer multiple is unavailable." }
        ],
        assumptions: {
          revenue_growth: growth5 ?? revenueGrowth ?? 5,
          operating_margin: opMargin ?? "not available — not used directly in this valuation",
          tax_rate: "not modeled directly in v1 FCF DCF",
          reinvestment: "embedded in observed FCF/share",
          fcf_growth: fcfGrowth5 ?? revenueGrowth ?? 5,
          discount_rate: 10,
          terminal_assumption: "2.5% base terminal growth",
          future_share_dilution: shareGrowth ?? 0
        },
        normalized_earnings_context:isBiopharma?{
          adjusted_eps_guidance_midpoint:adjustedEpsGuidance,
          price_to_adjusted_eps_guidance:normalizedEarningsYield==null?null:100/normalizedEarningsYield,
          annualized_dividend_per_share:annualDividend,
          dividend_yield_pct:currentPrice&&annualDividend?annualDividend/currentPrice*100:null
        }:null,
        model_warning: isBiopharma
          ? "Biopharma fair value is provisional until peer and multi-year valuation context are decision-grade; pipeline counts are not converted into revenue without asset-level probabilities."
          : "Fair values are scenario estimates, not predictions."
      },
      historical_valuation: historyRows,
      expected_return_scenarios: expectedReturns,
      risk_register: risks,
      investment_lenses: {
        buffett: {
          business_quality_fit: "Quantitative quality is " + quality + " (" + quantitativeQuality + "/100); qualitative moat and management evidence still require review.",
          valuation_fit: "Base fair value implies " + pct(upside) + " upside/downside from the research price.",
          conclusion: "Potential fit only if durable economics and qualitative moat evidence survive review and the margin of safety is sufficient."
        },
        lynch: {
          classification: growth5 != null && growth5 >= 15 ? "fast grower candidate" : growth5 != null && growth5 >= 5 ? "stalwart / moderate grower candidate" : "slow grower or cyclical candidate",
          growth_fit: "Revenue CAGR: " + pct(growth5) + "; current growth: " + pct(revenueGrowth) + ".",
          valuation_fit: "Base valuation signal: " + ratingFromUpside(upside).replaceAll("_", " ") + ".",
          conclusion: "The story is investable only if growth is understandable, durable and purchased at a valuation consistent with the growth rate."
        }
      },
      decision_dashboard: {
        current_price: currentPrice,
        market_cap: marketCap,
        enterprise_value: enterpriseValue,
        business_quality: quality,
        moat,
        financial_strength: quantitativeQuality,
        growth_outlook: normalizedGrowth,
        valuation: ratingFromUpside(upside),
        risk_level: risk,
        bear_case_fair_value: bearValue,
        base_case_fair_value: baseValue,
        bull_case_fair_value: bullValue,
        mos_25_price: baseValue == null ? null : baseValue * 0.75,
        mos_35_price: baseValue == null ? null : baseValue * 0.65,
        expected_5y_base_cagr: expectedReturns.find((r) => r.scenario === "base" && r.horizon_years === 5)?.expected_cagr ?? null,
        expected_10y_base_cagr: expectedReturns.find((r) => r.scenario === "base" && r.horizon_years === 10)?.expected_cagr ?? null,
        most_important_bull_argument: businessAssessment.bull_thesis,
        most_important_bear_argument: businessAssessment.bear_thesis,
        biggest_unknown: businessAssessment.biggest_unknown,
        thesis_breaker: risks[0].thesis_breaker,
        capital_allocation_test: businessAssessment.capital_allocation_test,
        classification: "private automated draft — analyst review required"
      },
      final_conclusion: {
        great_business: isBiopharma
          ? "Business quality cannot be inferred from GAAP margins alone; the key test is whether product/pipeline replacement economics can outrun the patent cliff while preserving normalized earnings and balance-sheet capacity."
          : "Quantitative evidence supports a " + quality + " business-quality assessment, but qualitative moat and management evidence must still be reviewed.",
        valuation: "Base fair value is " + (baseValue == null ? "not yet decision-grade" : "$" + baseValue.toFixed(2)) + ", implying " + pct(upside) + " upside/downside from the research price.",
        realistic_return: "Five-year base-case total-return CAGR is " + pct(expectedReturns.find((r) => r.scenario === "base" && r.horizon_years === 5)?.expected_cagr) + (annualDividend>0 ? ", including a flat current dividend assumption without reinvestment." : "."),
        impairment_risks: isBiopharma
          ? "Primary risks are the 2026-2030 patent cliff, pipeline conversion, pricing/reimbursement pressure, acquisition returns, leverage and dividend coverage."
          : "Primary monitored risks are growth durability, margin compression, valuation error and per-share capital allocation.",
        index_case: "Active ownership is justified only if the reviewed expected return and downside protection are superior enough to compensate for company-specific risk versus the broad-market benchmark."
      },
      thesis_variables: thesisVariables,
      scores: {
        quality_score: quantitativeQuality,
        growth_score: Math.round(clamp(50 + (growth5 ?? revenueGrowth ?? 0) * 2, 0, 100)),
        valuation_score: Math.round(clamp(50 + (upside ?? 0), 0, 100)),
        financial_strength_score: quantitativeQuality,
        moat_score: n(payload?.scores?.moat_score) ?? moatScoreFromRating(existingBusiness.moat_rating),
        thesis_integrity_score: Math.round(clamp(60 + Math.min(yearsCovered, 5) * 5 + Math.min(peerCoverage, 5) * 2, 0, 100)),
        overall_score: Math.round(clamp((quantitativeQuality * 0.45) + (Math.round(clamp(50 + (growth5 ?? revenueGrowth ?? 0) * 2, 0, 100)) * 0.25) + (Math.round(clamp(50 + (upside ?? 0), 0, 100)) * 0.30), 0, 100))
      },
      valuations: {
        bear_value: bearValue,
        base_value: baseValue,
        bull_value: bullValue,
        dcf_value: dcfBase,
        owner_earnings_value: dcfBase,
        earnings_multiple_value: multipleCases.base,
        historical_multiple_value: perShare.perShare == null ? null : perShare.perShare * median(hist.filter((h)=>h.available&&h.metric===perShare.metric).map((h) => h.median).filter((x) => x != null)),
        peer_value: perShare.perShare == null || peerMultiple == null ? null : perShare.perShare * peerMultiple,
        mos_25_price: baseValue == null ? null : baseValue * 0.75,
        mos_35_price: baseValue == null ? null : baseValue * 0.65,
        mos_50_price: baseValue == null ? null : baseValue * 0.50,
        discount_rate: 10,
        terminal_growth: 2.5,
        revenue_growth_assumption: growth5 ?? revenueGrowth ?? 5,
        margin_assumption: opMargin
      }
    }
  };
}
