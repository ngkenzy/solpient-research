import fs from "node:fs/promises";
import process from "node:process";

const beforePath=process.argv[2]??"group-a-production-pre.json";
const afterPath=process.argv[3]??"group-a-production-post.json";
const before=JSON.parse(await fs.readFile(beforePath,"utf8"));
const after=JSON.parse(await fs.readFile(afterPath,"utf8"));

const failures=[];
function same(path,a,b){
  if(a!==b) failures.push({path,before:a,after:b});
}

same(
  "published_research_runs",
  before?.ledger_counts?.published_research_runs,
  after?.ledger_counts?.published_research_runs
);
same(
  "locked_predictions",
  before?.ledger_counts?.locked_predictions,
  after?.ledger_counts?.locked_predictions
);
same(
  "realized_outcomes",
  before?.ledger_counts?.realized_outcomes,
  after?.ledger_counts?.realized_outcomes
);
same(
  "prediction_scores",
  before?.ledger_counts?.prediction_scores,
  after?.ledger_counts?.prediction_scores
);
same(
  "ranking_history",
  before?.ledger_counts?.ranking_history,
  after?.ledger_counts?.ranking_history
);

if(before?.representative||after?.representative){
  same(
    "ADBE latest published research root hash",
    before?.representative?.latestPublishedRunHash??null,
    after?.representative?.latestPublishedRunHash??null
  );
  same(
    "ADBE published child package hash",
    before?.representative?.childPackageHash??null,
    after?.representative?.childPackageHash??null
  );
  same(
    "ADBE published research version",
    before?.representative?.latestPublishedRun?.version??null,
    after?.representative?.latestPublishedRun?.version??null
  );
}

const report={
  checked_at:new Date().toISOString(),
  pass:failures.length===0,
  failures,
  evidence_growth:{
    normalized_facts_before:before?.ledger_counts?.normalized_facts??null,
    normalized_facts_after:after?.ledger_counts?.normalized_facts??null,
    evidence_observations_before:before?.ledger_counts?.evidence_observations??null,
    evidence_observations_after:after?.ledger_counts?.evidence_observations??null,
  },
};

console.log(JSON.stringify(report,null,2));
if(failures.length){
  process.exitCode=1;
}
