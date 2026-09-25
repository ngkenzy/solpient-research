import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const url=process.env.SUPABASE_URL?.trim();
const secret=process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if(!url||!secret) throw new Error("Missing SUPABASE_URL and server secret.");

const sb=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

const contracts={
  research_coverage_states:[
    "company_id","coverage_level","methodology_version","eligibility_evidence",
    "reason","evaluated_at","updated_at"
  ],
  research_coverage_history:[
    "id","company_id","from_level","to_level","methodology_version",
    "eligibility_evidence","transition_reason","evaluated_at","created_at"
  ],
  research_freshness_policies:[
    "methodology_version","component_key","max_check_age","max_review_age",
    "evidence_triggers_review","required_for_deep_coverage","description","created_at"
  ],
  research_component_freshness:[
    "company_id","component_key","last_checked_at","latest_evidence_at","last_reviewed_at",
    "last_recalculated_at","last_published_at","evidence_since_publication","status",
    "next_due_at","invalidated_at","invalidation_reason","policy_version","metadata","updated_at"
  ],
  research_dependency_rules:[
    "id","methodology_version","rule_key","match_module","match_metric_key",
    "affected_components","required_action","priority","rationale","created_at"
  ],
  research_component_invalidations:[
    "id","company_id","normalized_fact_id","company_change_event_id","component_key",
    "reason","severity","methodology_version","invalidated_at","status","resolved_at",
    "resulting_research_run_id","resolution_note","created_at","updated_at"
  ],
  research_maintenance_queue:[
    "id","company_id","trigger_type","trigger_evidence_type","trigger_evidence_id",
    "trigger_payload","detected_at","affected_components","priority","required_action",
    "status","attempt_count","last_error","started_at","completed_at",
    "resulting_research_run_id","dedupe_key","created_at","updated_at"
  ],
  research_maintenance_attempts:[
    "id","queue_item_id","attempt_number","worker_id","started_at","completed_at",
    "status","error_message","details","created_at"
  ],
};

const result={captured_at:new Date().toISOString(),tables:{}};
let failures=0;

for(const [table,columns] of Object.entries(contracts)){
  const {count,error}=await sb
    .from(table)
    .select(columns.join(","),{head:true,count:"exact"})
    .limit(0);

  if(error){
    failures+=1;
    result.tables[table]={
      contract_ok:false,
      expected_columns:columns,
      error:{code:error.code,message:error.message,details:error.details??null,hint:error.hint??null},
    };
  }else{
    result.tables[table]={
      contract_ok:true,
      expected_columns:columns,
      row_count:count??0,
    };
  }
}

console.log(JSON.stringify(result,null,2));
if(failures) process.exitCode=1;
