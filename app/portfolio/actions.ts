"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createConsumerServerClient } from "@/lib/supabase/server-client";

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
  revalidatePath("/portfolio");
}

export async function upsertPositionAction(formData:FormData) {
  const portfolioId=textField(formData,"portfolio_id");
  const ticker=textField(formData,"ticker").toUpperCase();
  const quantity=positiveNumber(textField(formData,"quantity"));
  const averageCost=nonNegativeNumber(textField(formData,"average_cost"));

  if(!portfolioId||!ticker||quantity===null) redirect("/portfolio?error=position");

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

  const {error}=await supabase.from("portfolio_positions").upsert({
    portfolio_id:portfolio.id,
    user_id:userId,
    company_id:company.id,
    quantity,
    average_cost:averageCost,
  },{
    onConflict:"portfolio_id,company_id",
  });

  if(error) redirect("/portfolio?error=position");
  revalidatePath("/portfolio");
}

export async function deletePositionAction(formData:FormData) {
  const id=textField(formData,"position_id");
  if(!id) redirect("/portfolio");

  const {supabase}=await requireUser();
  const {error}=await supabase.from("portfolio_positions").delete().eq("id",id);
  if(error) redirect("/portfolio?error=delete");

  revalidatePath("/portfolio");
}

export async function signOutAction() {
  const {supabase}=await requireUser();
  await supabase.auth.signOut();
  redirect("/");
}
