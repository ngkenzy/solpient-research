"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createConsumerServerClient } from "@/lib/supabase/server-client";
import { track } from "@/lib/analytics";

function field(formData:FormData,name:string){
  return String(formData.get(name)??"").trim();
}

async function requireUser(){
  const supabase=await createConsumerServerClient();
  const {data,error}=await supabase.auth.getClaims();
  const userId=data?.claims?.sub?String(data.claims.sub):null;
  if(error||!userId) redirect("/login");
  return{supabase,userId};
}

export async function saveResearchDemandAction(formData:FormData){
  const companyId=field(formData,"company_id");
  const requestType=field(formData,"request_type");
  const priority=Number(field(formData,"priority"));
  const question=field(formData,"question");
  const reason=field(formData,"reason");
  const allowed=new Set(["coverage","refresh","deep_dive","question"]);

  if(!companyId||!allowed.has(requestType)||!Number.isInteger(priority)||priority<1||priority>5){
    redirect("/research/request?error=save");
  }

  const {supabase,userId}=await requireUser();

  const {data:company,error:companyError}=await supabase
    .from("companies")
    .select("id")
    .eq("id",companyId)
    .maybeSingle();

  if(companyError||!company) redirect("/research/request?error=company");

  const {error}=await supabase
    .from("research_demand_requests")
    .upsert({
      user_id:userId,
      company_id:companyId,
      request_type:requestType,
      priority,
      question:question||null,
      reason:reason||null,
      active:true,
    },{
      onConflict:"user_id,company_id",
    });

  if(error) redirect("/research/request?error=save");

  await track("research_requested",{company_id:companyId,request_type:requestType});

  revalidatePath("/research/request");
}

export async function deleteResearchDemandAction(formData:FormData){
  const id=field(formData,"request_id");
  if(!id) redirect("/research/request");

  const {supabase}=await requireUser();
  const {error}=await supabase
    .from("research_demand_requests")
    .delete()
    .eq("id",id);

  if(error) redirect("/research/request?error=delete");
  revalidatePath("/research/request");
}
