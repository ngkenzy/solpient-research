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

export async function submitWhatMattersFeedbackAction(formData:FormData){
  const positionId=field(formData,"position_id");
  const itemId=field(formData,"item_id");
  const eventId=field(formData,"event_id");
  const feedbackType=field(formData,"feedback_type");
  const note=field(formData,"note");
  const allowed=new Set(["useful","not_useful","too_late","wrong_reason"]);

  if(!positionId||!itemId||!eventId||!allowed.has(feedbackType)){
    redirect("/what-matters?error=feedback");
  }

  const {supabase,userId}=await requireUser();

  const {data:position,error:positionError}=await supabase
    .from("portfolio_positions")
    .select("id")
    .eq("id",positionId)
    .maybeSingle();

  if(positionError||!position) redirect("/what-matters?error=feedback");

  const {error}=await supabase
    .from("what_matters_feedback")
    .upsert({
      user_id:userId,
      position_id:positionId,
      item_id:itemId,
      event_id:eventId,
      feedback_type:feedbackType,
      note:note||null,
    },{
      onConflict:"user_id,item_id",
    });

  if(error) redirect("/what-matters?error=feedback");

  revalidatePath("/what-matters");
}

export async function reportMissedEventAction(formData:FormData){
  const positionId=field(formData,"position_id");
  const expectedEvent=field(formData,"expected_event");
  const note=field(formData,"note");
  const occurredOn=field(formData,"occurred_on");

  if(!positionId||expectedEvent.length<3){
    redirect("/what-matters?error=missed");
  }

  const {supabase,userId}=await requireUser();

  const {data:position,error:positionError}=await supabase
    .from("portfolio_positions")
    .select("id")
    .eq("id",positionId)
    .maybeSingle();

  if(positionError||!position) redirect("/what-matters?error=missed");

  const {error}=await supabase
    .from("what_matters_missed_events")
    .insert({
      user_id:userId,
      position_id:positionId,
      expected_event:expectedEvent,
      note:note||null,
      occurred_on:occurredOn||null,
    });

  if(error) redirect("/what-matters?error=missed");

  revalidatePath("/what-matters");
}
