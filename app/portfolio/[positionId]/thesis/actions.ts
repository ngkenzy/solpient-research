"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createConsumerServerClient } from "@/lib/supabase/server-client";

function field(formData:FormData,name:string){
  return String(formData.get(name)??"").trim();
}

function importanceValue(value:string){
  const parsed=Number(value);
  return Number.isInteger(parsed)&&parsed>=1&&parsed<=5?parsed:3;
}

async function requireUser(){
  const supabase=await createConsumerServerClient();
  const {data,error}=await supabase.auth.getClaims();
  const userId=data?.claims?.sub?String(data.claims.sub):null;
  if(error||!userId) redirect("/login");
  return{supabase,userId};
}

async function requirePosition(positionId:string){
  const {supabase,userId}=await requireUser();
  const {data:position,error}=await supabase
    .from("portfolio_positions")
    .select("id,user_id,company_id")
    .eq("id",positionId)
    .maybeSingle();

  if(error||!position) redirect("/portfolio?error=portfolio-access");
  return{supabase,userId,position};
}

function thesisPath(positionId:string){
  return "/portfolio/"+positionId+"/thesis";
}

export async function saveCanonicalFactorAction(formData:FormData){
  const positionId=field(formData,"position_id");
  const thesisVariableId=field(formData,"canonical_thesis_variable_id");
  const importance=importanceValue(field(formData,"importance"));
  const personalExpectation=field(formData,"personal_expectation");
  const personalBreaker=field(formData,"personal_breaker_condition");
  const enabled=field(formData,"enabled")==="on";

  if(!positionId||!thesisVariableId) redirect("/portfolio");

  const {supabase,userId}=await requirePosition(positionId);

  const {data:existing,error:existingError}=await supabase
    .from("position_thesis_factors")
    .select("id")
    .eq("position_id",positionId)
    .eq("canonical_thesis_variable_id",thesisVariableId)
    .maybeSingle();

  if(existingError) redirect(thesisPath(positionId)+"?error=save");

  if(existing?.id){
    const {error}=await supabase
      .from("position_thesis_factors")
      .update({
        importance,
        personal_expectation:personalExpectation||null,
        personal_breaker_condition:personalBreaker||null,
        enabled,
      })
      .eq("id",existing.id);

    if(error) redirect(thesisPath(positionId)+"?error=save");
  }else{
    const {error}=await supabase
      .from("position_thesis_factors")
      .insert({
        position_id:positionId,
        user_id:userId,
        source_type:"canonical",
        canonical_thesis_variable_id:thesisVariableId,
        factor_key:"canonical:pending",
        factor_label:"Canonical factor",
        importance,
        personal_expectation:personalExpectation||null,
        personal_breaker_condition:personalBreaker||null,
        enabled,
      });

    if(error) redirect(thesisPath(positionId)+"?error=save");
  }

  revalidatePath(thesisPath(positionId));
  revalidatePath("/portfolio");
}

export async function addCustomFactorAction(formData:FormData){
  const positionId=field(formData,"position_id");
  const label=field(formData,"factor_label");
  const importance=importanceValue(field(formData,"importance"));
  const personalExpectation=field(formData,"personal_expectation");
  const personalBreaker=field(formData,"personal_breaker_condition");

  if(!positionId||!label||label.length>240) redirect(thesisPath(positionId)+"?error=custom");

  const {supabase,userId}=await requirePosition(positionId);

  const {error}=await supabase
    .from("position_thesis_factors")
    .insert({
      position_id:positionId,
      user_id:userId,
      source_type:"custom",
      canonical_thesis_variable_id:null,
      factor_key:"custom:"+randomUUID(),
      factor_label:label,
      importance,
      personal_expectation:personalExpectation||null,
      personal_breaker_condition:personalBreaker||null,
      enabled:true,
    });

  if(error) redirect(thesisPath(positionId)+"?error=custom");

  revalidatePath(thesisPath(positionId));
  revalidatePath("/portfolio");
}

export async function deleteThesisFactorAction(formData:FormData){
  const positionId=field(formData,"position_id");
  const factorId=field(formData,"factor_id");

  if(!positionId||!factorId) redirect("/portfolio");

  const {supabase}=await requirePosition(positionId);
  const {error}=await supabase
    .from("position_thesis_factors")
    .delete()
    .eq("id",factorId)
    .eq("position_id",positionId);

  if(error) redirect(thesisPath(positionId)+"?error=delete");

  revalidatePath(thesisPath(positionId));
  revalidatePath("/portfolio");
}
