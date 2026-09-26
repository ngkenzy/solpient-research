"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createConsumerServerClient } from "@/lib/supabase/server-client";

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

export async function savePositionAttentionAction(formData:FormData){
  const positionId=field(formData,"position_id");
  const minimumLevel=field(formData,"minimum_level");
  const attentionEnabled=field(formData,"attention_enabled")==="on";
  const digestEnabled=field(formData,"digest_enabled")==="on";
  const allowed=new Set(["thesis_priority","important","monitor","background"]);

  if(!positionId||!allowed.has(minimumLevel)){
    redirect("/portfolio?error=portfolio-access");
  }

  const {supabase,userId}=await requireUser();

  const {data:position,error:positionError}=await supabase
    .from("portfolio_positions")
    .select("id")
    .eq("id",positionId)
    .maybeSingle();

  if(positionError||!position) redirect("/portfolio?error=portfolio-access");

  const {error}=await supabase
    .from("position_attention_preferences")
    .upsert({
      position_id:positionId,
      user_id:userId,
      attention_enabled:attentionEnabled,
      minimum_level:minimumLevel,
      digest_enabled:digestEnabled,
    },{
      onConflict:"position_id",
    });

  if(error) redirect("/portfolio/"+positionId+"/attention?error=save");

  revalidatePath("/portfolio");
  revalidatePath("/portfolio/"+positionId+"/attention");
  revalidatePath("/inbox");
  revalidatePath("/digest");
}
