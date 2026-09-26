"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createConsumerServerClient } from "@/lib/supabase/server-client";

function field(formData:FormData,name:string) {
  return String(formData.get(name)??"").trim();
}

export async function signInAction(formData:FormData) {
  const email=field(formData,"email").toLowerCase();
  const password=field(formData,"password");

  if(!email||!password) redirect("/login?error=missing");

  const supabase=await createConsumerServerClient();
  const {error}=await supabase.auth.signInWithPassword({email,password});

  if(error) redirect("/login?error=signin");
  redirect("/portfolio");
}

export async function signUpAction(formData:FormData) {
  const email=field(formData,"email").toLowerCase();
  const password=field(formData,"password");
  const displayName=field(formData,"display_name");

  if(!email||password.length<8) redirect("/login?mode=signup&error=signup");

  const requestHeaders=await headers();
  const origin=requestHeaders.get("origin") ?? requestHeaders.get("x-forwarded-host");
  const callbackOrigin=origin?.startsWith("http") ? origin : origin ? "https://"+origin : null;

  const supabase=await createConsumerServerClient();
  const {data,error}=await supabase.auth.signUp({
    email,
    password,
    options:{
      data:{display_name:displayName||null},
      ...(callbackOrigin ? {emailRedirectTo:callbackOrigin+"/auth/callback?next=/onboarding"} : {}),
    },
  });

  if(error) redirect("/login?mode=signup&error=signup");
  if(data.session) redirect("/onboarding");
  redirect("/login?message=check-email");
}
