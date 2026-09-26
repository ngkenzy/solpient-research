"use server";

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

export async function addOnboardingPositionAction(formData:FormData){
  const ticker=field(formData,"ticker").toUpperCase();
  const quantity=Number(field(formData,"quantity"));
  const averageCostRaw=field(formData,"average_cost");
  const averageCost=averageCostRaw?Number(averageCostRaw):null;

  if(!ticker||!Number.isFinite(quantity)||quantity<=0){
    redirect("/onboarding?error=position");
  }
  if(averageCost!==null&&(!Number.isFinite(averageCost)||averageCost<0)){
    redirect("/onboarding?error=position");
  }

  const {supabase,userId}=await requireUser();

  const [{data:portfolio,error:portfolioError},{data:company,error:companyError}]=await Promise.all([
    supabase
      .from("portfolios")
      .select("id")
      .eq("user_id",userId)
      .eq("is_default",true)
      .maybeSingle(),
    supabase
      .from("companies")
      .select("id,ticker")
      .eq("ticker",ticker)
      .maybeSingle(),
  ]);

  if(portfolioError||!portfolio) redirect("/onboarding?error=portfolio");
  if(companyError||!company) redirect("/onboarding?error=ticker");

  const {error}=await supabase
    .from("portfolio_positions")
    .upsert({
      portfolio_id:portfolio.id,
      user_id:userId,
      company_id:company.id,
      quantity,
      average_cost:averageCost,
    },{
      onConflict:"portfolio_id,company_id",
    });

  if(error) redirect("/onboarding?error=position");
  redirect("/onboarding");
}

export async function finishOnboardingAction(){
  const {supabase,userId}=await requireUser();

  const {count}=await supabase
    .from("portfolio_positions")
    .select("id",{count:"exact",head:true})
    .eq("user_id",userId);

  if(!count) redirect("/onboarding?error=need-position");

  const {error}=await supabase
    .from("profiles")
    .update({onboarding_completed:true})
    .eq("user_id",userId);

  if(error) redirect("/onboarding?error=finish");
  redirect("/what-matters");
}

export async function skipOnboardingAction(){
  const {supabase,userId}=await requireUser();
  await supabase
    .from("profiles")
    .update({onboarding_completed:true})
    .eq("user_id",userId);
  redirect("/portfolio");
}
