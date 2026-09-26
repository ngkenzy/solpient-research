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

export async function refreshThesisAlertsAction(){
  const {supabase}=await requireUser();
  const {error}=await supabase.rpc("refresh_my_thesis_alerts_v1");
  if(error) redirect("/inbox?error=refresh");
  revalidatePath("/inbox");
}

export async function saveAlertPreferencesAction(formData:FormData){
  const minimumLevel=field(formData,"minimum_level");
  const inApp=field(formData,"in_app_enabled")==="on";
  const dailyDigest=field(formData,"daily_digest_enabled")==="on";
  const allowed=new Set(["thesis_priority","important","monitor","background"]);

  if(!allowed.has(minimumLevel)) redirect("/inbox?error=preferences");

  const {supabase,userId}=await requireUser();
  const {error}=await supabase
    .from("user_alert_preferences")
    .upsert({
      user_id:userId,
      minimum_level:minimumLevel,
      in_app_enabled:inApp,
      daily_digest_enabled:dailyDigest,
    },{
      onConflict:"user_id",
    });

  if(error) redirect("/inbox?error=preferences");
  revalidatePath("/inbox");
}

export async function setThesisAlertStateAction(formData:FormData){
  const id=field(formData,"alert_id");
  const state=field(formData,"state");
  const allowed=new Set(["unread","read","dismissed"]);
  if(!id||!allowed.has(state)) redirect("/inbox?error=state");

  const {supabase}=await requireUser();
  const now=new Date().toISOString();
  const payload={
    state,
    read_at:state==="read"?now:null,
    dismissed_at:state==="dismissed"?now:null,
  };

  const {error}=await supabase
    .from("thesis_alerts")
    .update(payload)
    .eq("id",id);

  if(error) redirect("/inbox?error=state");
  revalidatePath("/inbox");
}
