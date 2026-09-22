import { canonicalSha256 } from "./integrity-hash.mjs";
import { buildUniverseQAReport, UNIVERSE_QA_VERSION } from "./universe-qa-engine.mjs";
import { classifyIssuerSector } from "./universe-sector-model-v2-3.mjs";
import { deriveLifecycle, assessActivationReadiness } from "./methodology-governance.mjs";

export const METHODOLOGY_ACTIVATION_VERSION="methodology-validation-activation-v1";

export const UNIVERSE_METHOD_STACK=Object.freeze([
  Object.freeze({
    methodology_key:"universe_sector_model",
    version:"solpient-universe-sector-model-v2.3",
  }),
  Object.freeze({
    methodology_key:"sector_evidence_model",
    version:"solpient-sector-evidence-model-v2.1",
  }),
  Object.freeze({
    methodology_key:"universe_screening",
    version:"solpient-universe-screen-v2.3",
  }),
  Object.freeze({
    methodology_key:"research_candidate_pipeline",
    version:"research-candidate-pipeline-v2.3",
  }),
]);

export const SCREEN_MATERIALIZATION_STACK=Object.freeze(
  UNIVERSE_METHOD_STACK.slice(0,3)
);

const key=(x)=>x.methodology_key+"|"+x.version;

export function auditClassificationCoverage(rows=[]){
  const results=rows.map(row=>{
    const classification=classifyIssuerSector({
      ticker:row.ticker,
      cik:row.cik,
      companyName:row.company_name??row.companyName,
      sic:row.sic,
      sicDescription:row.sic_description??row.sicDescription??"",
      existingSector:row.sector,
      existingIndustry:row.industry,
      existingScreenProfile:row.screen_profile,
    });
    return{
      ticker:String(row.ticker??"").trim().toUpperCase(),
      company_name:row.company_name??row.companyName??null,
      sector:classification.sector,
      method:classification.classification_method,
      review_required:Boolean(classification.classification_review_required),
      review_reason:classification.classification_review_reason??null,
    };
  });
  const reviewQueue=results.filter(x=>x.method==="review_required"||x.review_required);
  const unresolved=results.filter(x=>x.method==="unresolved");
  const obviousUnknown=results.filter(x=>
    x.sector==="Unknown"&&
    x.method!=="review_required"&&
    x.method!=="unresolved"
  );
  return{
    input_count:results.length,
    review_required_count:reviewQueue.length,
    unresolved_count:unresolved.length,
    obvious_unknown_count:obviousUnknown.length,
    review_queue:reviewQueue,
    unresolved,
    obvious_unknown:obviousUnknown,
  };
}

export function buildMethodologyValidationBundle(rows=[],options={}){
  const limit=Math.max(1,Number(options.limit??100)||100);
  const minInputCount=Math.max(0,Number(options.minInputCount??0)||0);
  const qa=buildUniverseQAReport(rows,{limit,thresholds:options.qaThresholds??{}});
  const classification=auditClassificationCoverage(rows);
  const acceptance={
    qa_blockers_zero:qa.blockers===0,
    classification_obvious_unknown_zero:classification.obvious_unknown_count===0,
    classification_unresolved_zero:classification.unresolved_count===0,
    shortlist_nonempty:(qa.funnel?.proposed_deep_research??0)>0,
    review_items_acknowledged:qa.review_items===0||options.acknowledgeReviewItems===true,
    classification_review_queue_acknowledged:
      classification.review_required_count===0||
      options.acknowledgeClassificationReviewQueue===true,
    full_universe_size:rows.length>=minInputCount,
  };
  const blockingReasons=[];
  if(!acceptance.qa_blockers_zero)blockingReasons.push("Universe QA has blocker findings.");
  if(!acceptance.classification_obvious_unknown_zero)blockingReasons.push("Obvious operating companies remain Unknown.");
  if(!acceptance.classification_unresolved_zero)blockingReasons.push("Untracked unresolved classifications remain.");
  if(!acceptance.shortlist_nonempty)blockingReasons.push("Deep-research shortlist is empty.");
  if(!acceptance.review_items_acknowledged){
    blockingReasons.push("Universe QA review items require explicit acknowledgement.");
  }
  if(!acceptance.classification_review_queue_acknowledged){
    blockingReasons.push("Classification review queue requires explicit acknowledgement.");
  }
  if(!acceptance.full_universe_size){
    blockingReasons.push(
      "Input count "+rows.length+" is below the required validation minimum "+minInputCount+"."
    );
  }

  const payload={
    activation_version:METHODOLOGY_ACTIVATION_VERSION,
    qa_version:UNIVERSE_QA_VERSION,
    screening_methodology_version:qa.screening_methodology_version,
    input_count:rows.length,
    min_input_count:minInputCount,
    shortlist_count:qa.funnel?.proposed_deep_research??0,
    qa_status:qa.status,
    qa_blockers:qa.blockers,
    qa_review_items:qa.review_items,
    qa_findings:qa.findings,
    classification,
    acceptance,
    blocking_reasons:blockingReasons,
    methodology_stack:UNIVERSE_METHOD_STACK,
  };
  return{
    ...payload,
    ready:blockingReasons.length===0,
    validation_hash:canonicalSha256(payload),
  };
}

export function methodologyStackStatus(definitions=[],events=[],stack=UNIVERSE_METHOD_STACK){
  const defsByIdentity=new Map(definitions.map(d=>[
    d.methodology_key+"|"+d.version,d
  ]));
  const eventsByDef=new Map();
  for(const event of events){
    const list=eventsByDef.get(event.methodology_definition_id)??[];
    list.push(event);
    eventsByDef.set(event.methodology_definition_id,list);
  }

  const rows=stack.map(spec=>{
    const def=defsByIdentity.get(key(spec))??null;
    const lifecycle=def?deriveLifecycle(eventsByDef.get(def.id)??[]):null;
    return{
      ...spec,
      registered:Boolean(def),
      definition_id:def?.id??null,
      lifecycle_state:lifecycle,
      active:lifecycle==="active",
      manifest:def?.manifest??null,
    };
  });
  return{
    ready:rows.every(x=>x.active),
    missing:rows.filter(x=>!x.registered).map(key),
    inactive:rows.filter(x=>x.registered&&!x.active).map(x=>({
      identity:key(x),state:x.lifecycle_state,
    })),
    rows,
  };
}

export function activationReadinessForStack(definitions=[],events=[],validations=[],stack=UNIVERSE_METHOD_STACK){
  const status=methodologyStackStatus(definitions,events,stack);
  const validationsByDef=new Map();
  for(const row of validations){
    const list=validationsByDef.get(row.methodology_definition_id)??[];
    list.push(row);validationsByDef.set(row.methodology_definition_id,list);
  }
  const rows=status.rows.map(row=>{
    if(!row.registered)return{...row,activation_readiness:null};
    const def=definitions.find(d=>d.id===row.definition_id);
    return{
      ...row,
      activation_readiness:assessActivationReadiness(
        def?.manifest??def,
        validationsByDef.get(row.definition_id)??[]
      ),
    };
  });
  return{
    ready:rows.every(r=>r.registered&&r.activation_readiness?.ready),
    rows,
  };
}

export function requiredValidationEvidence(bundle={}){
  if(!bundle.ready){
    throw new Error("Validation bundle is not activation-ready: "+(bundle.blocking_reasons??[]).join(" "));
  }
  const common=[
    {
      validation_type:"unit_tests",
      evidence_ref:"CI: screening/sector evidence/classification/candidate regressions",
    },
    {
      validation_type:"build",
      evidence_ref:"CI: full Solpient production build",
    },
    {
      validation_type:"historical_integrity",
      evidence_ref:"Versioned V1/V2/V2.1/V2.2 engines preserved; append-only screen history",
    },
  ];
  return{
    "universe_sector_model|solpient-universe-sector-model-v2.3":[
      ...common,
      {
        validation_type:"methodology_regression",
        evidence_ref:"V2.3 classification coverage fixture + full-universe classification audit hash "+bundle.validation_hash,
      },
    ],
    "sector_evidence_model|solpient-sector-evidence-model-v2.1":[
      ...common,
      {
        validation_type:"methodology_regression",
        evidence_ref:"V2.1 sector-evidence ceiling regressions + full-universe QA hash "+bundle.validation_hash,
      },
    ],
    "universe_screening|solpient-universe-screen-v2.3":[
      ...common,
      {
        validation_type:"db_invariant",
        evidence_ref:"Append-only universe_screen_runs/results schema and live DB invariant verification",
      },
      {
        validation_type:"methodology_regression",
        evidence_ref:"Full-universe QA/classification validation hash "+bundle.validation_hash,
      },
    ],
    "research_candidate_pipeline|research-candidate-pipeline-v2.3":[
      ...common,
      {
        validation_type:"db_invariant",
        evidence_ref:"Append-only candidate pipeline schema and live DB invariant verification",
      },
      {
        validation_type:"manual_review",
        evidence_ref:"Explicit user approval of Methodology Validation & Activation V1",
      },
    ],
  };
}
