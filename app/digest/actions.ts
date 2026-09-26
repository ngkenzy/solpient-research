"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createConsumerServerClient } from "@/lib/supabase/server-client";

export async function refreshDailyDigestAction(){
  const supabase=await createConsumerServerClient();
  const {data,error}=await supabase.auth.getClaims();
  if(error||!data?.claims?.sub) redirect("/login");

  const {error:refreshError}=await supabase.rpc("refresh_my_daily_digest_v1");
  if(refreshError) redirect("/digest?error=refresh");

  revalidatePath("/digest");
}
