import { postgresConfigured } from "./postgres-node.mjs";
import { latestAutonomousIndustryAssignmentPg } from "./factory-storage-pg.mjs";

export async function latestAutonomousIndustryAssignment(sb,{companyId=null,researchFactoryItemId=null,ticker=null}={}){
  if(postgresConfigured()){
    return latestAutonomousIndustryAssignmentPg({companyId,researchFactoryItemId,ticker});
  }

  if(!sb)return null;
  let query=sb.from("research_factory_industry_assignments")
    .select("*")
    .eq("status","applied")
    .order("created_at",{ascending:false})
    .limit(1);
  if(researchFactoryItemId)query=query.eq("research_factory_item_id",researchFactoryItemId);
  else if(companyId)query=query.eq("company_id",companyId);
  else if(ticker)query=query.eq("ticker",String(ticker).toUpperCase());
  else return null;
  const {data,error}=await query.maybeSingle();
  if(error)throw error;
  return data??null;
}

export async function latestAutonomousIndustryModule(sb,args={}){
  const assignment=await latestAutonomousIndustryAssignment(sb,args);
  return assignment?.module??null;
}
