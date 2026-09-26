export const COVERAGE_LEVELS=Object.freeze({
  MONITORED:"MONITORED",
  RESEARCHED:"RESEARCHED",
  DEEP_COVERAGE:"DEEP_COVERAGE",
  UNSUPPORTED:"UNSUPPORTED",
});

export const FRESHNESS_STATUS=Object.freeze({
  CURRENT:"CURRENT",
  STALE:"STALE",
  REVIEW_DUE:"REVIEW_DUE",
  NEW_EVIDENCE:"NEW_EVIDENCE",
  NOT_SUPPORTED:"NOT_SUPPORTED",
  UNKNOWN:"UNKNOWN",
});

function ms(value){
  if(value==null)return null;
  if(value instanceof Date)return value.getTime();
  const n=new Date(value).getTime();
  return Number.isFinite(n)?n:null;
}

export function deriveFreshnessStatus({
  supported=true,
  evidenceSincePublication=false,
  invalidated=false,
  lastCheckedAt=null,
  maxCheckAgeMs=null,
  lastReviewAt=null,
  maxReviewAgeMs=null,
  asOf=new Date(),
}={}){
  if(!supported)return FRESHNESS_STATUS.NOT_SUPPORTED;
  if(evidenceSincePublication)return FRESHNESS_STATUS.NEW_EVIDENCE;
  if(invalidated)return FRESHNESS_STATUS.REVIEW_DUE;

  const now=ms(asOf);
  const checked=ms(lastCheckedAt);
  const reviewed=ms(lastReviewAt);

  if(maxReviewAgeMs!=null){
    if(reviewed==null)return FRESHNESS_STATUS.UNKNOWN;
    if(reviewed+Number(maxReviewAgeMs)<now)return FRESHNESS_STATUS.REVIEW_DUE;
  }
  if(maxCheckAgeMs!=null){
    if(checked==null)return FRESHNESS_STATUS.UNKNOWN;
    if(checked+Number(maxCheckAgeMs)<now)return FRESHNESS_STATUS.STALE;
  }
  return FRESHNESS_STATUS.CURRENT;
}

export function deriveCoverageLevel(evidence={}){
  // UNSUPPORTED means "insufficient data or security type not currently supported".
  // Exact rule: a company has no usable evidence base when it has no market data
  // AND no fundamentals AND no SEC filings. Any one of the three makes the
  // company at least monitorable, i.e. MONITORED or better.
  const hasMarketData=Boolean(evidence.hasMarketData);
  const hasFundamentals=Boolean(evidence.hasFundamentals);
  const hasSecFilings=Boolean(evidence.hasSecFilings);
  if(!hasMarketData&&!hasFundamentals&&!hasSecFilings)return COVERAGE_LEVELS.UNSUPPORTED;

  const researched=Boolean(
    evidence.hasPublishedResearch &&
    evidence.hasBusinessAssessment &&
    Number(evidence.thesisVariableCount??0)>0 &&
    evidence.hasValuation &&
    Number(evidence.riskCount??0)>0 &&
    evidence.hasFrozenInputManifest
  );

  const deep=Boolean(
    researched &&
    Number(evidence.publishedResearchVersions??0)>=2 &&
    Number(evidence.lockedPredictionCount??0)>=1 &&
    Number(evidence.valuationHistoryCount??0)>=12 &&
    Number(evidence.capitalAllocationYears??0)>=3 &&
    Number(evidence.requiredFreshComponentsTotal??0)>0 &&
    Number(evidence.requiredFreshComponentsCurrent??0)===
      Number(evidence.requiredFreshComponentsTotal??0)
  );

  if(deep)return COVERAGE_LEVELS.DEEP_COVERAGE;
  if(researched)return COVERAGE_LEVELS.RESEARCHED;
  return COVERAGE_LEVELS.MONITORED;
}

export function canPersistCoverage(requestedLevel,evidence={}){
  // UNSUPPORTED is picked up automatically via Object.values(COVERAGE_LEVELS).
  if(!Object.values(COVERAGE_LEVELS).includes(requestedLevel))return false;
  return requestedLevel===deriveCoverageLevel(evidence);
}
