"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createConsumerServerClient } from "@/lib/supabase/server-client";

function field(formData:FormData,name:string){
  return String(formData.get(name)??"").trim();
}

export async function recordDecisionAction(formData:FormData){
  const positionId=field(formData,"position_id");
  const decisionType=field(formData,"decision_type");
  const conviction=Number(field(formData,"conviction"));
  const rationale=field(formData,"rationale");
  const triggerItemId=field(formData,"trigger_item_id")||null;
  const supersedesDecisionId=field(formData,"supersedes_decision_id")||null;
  const allowed=new Set(["watch","hold","add","trim","exit"]);

  if(!positionId||!allowed.has(decisionType)||!Number.isInteger(conviction)||conviction<1||conviction>5||rationale.length<3){
    redirect("/portfolio/"+positionId+"/journal?error=save");
  }

  const supabase=await createConsumerServerClient();
  const {data:claims,error:claimsError}=await supabase.auth.getClaims();
  if(claimsError||!claims?.claims?.sub) redirect("/login");

  const {error}=await supabase.rpc("record_my_position_decision_v1",{
    p_position_id:positionId,
    p_decision_type:decisionType,
    p_conviction:conviction,
    p_rationale:rationale,
    p_trigger_item_id:triggerItemId,
    p_supersedes_decision_id:supersedesDecisionId,
  });

  if(error) redirect("/portfolio/"+positionId+"/journal?error=save");

  revalidatePath("/portfolio/"+positionId+"/journal");
}
