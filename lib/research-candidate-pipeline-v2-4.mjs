import {
  RESEARCH_CANDIDATE_PIPELINE_VERSION as PREDECESSOR_PIPELINE_VERSION,
  buildResearchCandidatePipeline as buildV23Pipeline,
} from "./research-candidate-pipeline.mjs";

export const RESEARCH_CANDIDATE_PIPELINE_VERSION="research-candidate-pipeline-v2.4";
export const RESEARCH_CANDIDATE_PIPELINE_PREDECESSOR_VERSION=PREDECESSOR_PIPELINE_VERSION;

function normalizeAsOf(value){
  const d=value instanceof Date?value:new Date(value);
  if(!Number.isFinite(d.getTime())){
    throw new Error("Research Candidate Pipeline V2.4 requires a valid evaluationAsOf timestamp.");
  }
  return d.toISOString();
}

export function buildResearchCandidatePipeline({
  evaluationAsOf,
  ...input
}={}){
  if(!evaluationAsOf){
    throw new Error(
      "Research Candidate Pipeline V2.4 requires explicit evaluationAsOf; wall-clock defaults are not allowed."
    );
  }
  const normalizedAsOf=normalizeAsOf(evaluationAsOf);
  const output=buildV23Pipeline({
    ...input,
    now:new Date(normalizedAsOf),
  });

  return{
    ...output,
    pipelineVersion:RESEARCH_CANDIDATE_PIPELINE_VERSION,
    predecessorPipelineVersion:RESEARCH_CANDIDATE_PIPELINE_PREDECESSOR_VERSION,
    evaluationAsOf:normalizedAsOf,
    safeguards:[
      ...(output.safeguards??[]),
      "Pipeline V2.4 readiness is evaluated at an explicit immutable timestamp rather than the materialization wall clock.",
      "Pipeline V2.4 publication is bound to one explicit immutable universe-screen run.",
    ],
  };
}
