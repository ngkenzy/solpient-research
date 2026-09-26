"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createConsumerServerClient } from "@/lib/supabase/server-client";
import { track } from "@/lib/analytics";

async function requireUser() {
  const supabase=await createConsumerServerClient();
  const {data,error}=await supabase.auth.getClaims();
  const userId=data?.claims?.sub ? String(data.claims.sub) : null;
  if(error||!userId) redirect("/login");
  return{supabase,userId};
}

function textField(formData:FormData,name:string) {
  return String(formData.get(name)??"").trim();
}

function positiveNumber(value:string) {
  const n=Number(value);
  return Number.isFinite(n)&&n>0?n:null;
}

function nonNegativeNumber(value:string) {
  if(!value) return null;
  const n=Number(value);
  return Number.isFinite(n)&&n>=0?n:null;
}

function optionalWeightPercent(value:string) {
  if(!value) return null;
  const n=Number(value);
  if(!Number.isFinite(n)||n<0||n>100) return undefined;
  return n;
}

function relationshipField(value:string) {
  return value==="follow"?"follow":"own";
}

export async function createPortfolioAction(formData:FormData) {
  const name=textField(formData,"name");
  if(!name||name.length>120) redirect("/portfolio?error=portfolio");

  const {supabase,userId}=await requireUser();
  const {error}=await supabase.from("portfolios").insert({
    user_id:userId,
    name,
    is_default:false,
    base_currency:"USD",
  });

  if(error) redirect("/portfolio?error=portfolio");
  await track("portfolio_created");
  revalidatePath("/portfolio");
}

export async function upsertPositionAction(formData:FormData) {
  const portfolioId=textField(formData,"portfolio_id");
  const ticker=textField(formData,"ticker").toUpperCase();
  const quantity=positiveNumber(textField(formData,"quantity"));
  const averageCost=nonNegativeNumber(textField(formData,"average_cost"));
  const relationship=relationshipField(textField(formData,"relationship"));
  const marketValue=nonNegativeNumber(textField(formData,"market_value"));
  const weightPct=optionalWeightPercent(textField(formData,"weight"));

  if(!portfolioId||!ticker||quantity===null) redirect("/portfolio?error=position");
  if(weightPct===undefined) redirect("/portfolio?error=position");

  const {supabase,userId}=await requireUser();

  const {data:portfolio,error:portfolioError}=await supabase
    .from("portfolios")
    .select("id")
    .eq("id",portfolioId)
    .maybeSingle();

  if(portfolioError||!portfolio) redirect("/portfolio?error=portfolio-access");

  const {data:company,error:companyError}=await supabase
    .from("companies")
    .select("id,ticker")
    .eq("ticker",ticker)
    .maybeSingle();

  if(companyError||!company) redirect("/portfolio?error=ticker");

  // Monitored-name cap: only enforced when this company is not already monitored.
  const {data:profile}=await supabase.from("profiles").select("monitored_name_cap").eq("user_id",userId).maybeSingle();
  const {data:monitored}=await supabase.from("portfolio_positions").select("company_id").eq("user_id",userId);
  const monitoredNameCap=Number(profile?.monitored_name_cap)||12;
  const monitoredIds=(monitored??[]).map((row:any)=>String(row.company_id));
  if(!monitoredIds.includes(String(company.id))&&new Set(monitoredIds).size>=monitoredNameCap) redirect("/portfolio?error=cap");

  const {error}=await supabase.from("portfolio_positions").upsert({
    portfolio_id:portfolio.id,
    user_id:userId,
    company_id:company.id,
    quantity,
    average_cost:averageCost,
    relationship,
    market_value:marketValue,
    weight:weightPct,
  },{
    onConflict:"portfolio_id,company_id",
  });

  if(error){
    if(String(error.message??"").includes("monitored_name_limit_exceeded")) redirect("/portfolio?error=cap");
    redirect("/portfolio?error=position");
  }
  await track("position_added",{ticker,relationship});
  revalidatePath("/portfolio");
}

export async function deletePositionAction(formData:FormData) {
  const id=textField(formData,"position_id");
  if(!id) redirect("/portfolio");

  const {supabase}=await requireUser();
  const {error}=await supabase.from("portfolio_positions").delete().eq("id",id);
  if(error) redirect("/portfolio?error=delete");

  await track("position_removed");

  revalidatePath("/portfolio");
}

export async function signOutAction() {
  const {supabase}=await requireUser();
  await supabase.auth.signOut();
  redirect("/");
}
