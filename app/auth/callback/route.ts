import { NextResponse, type NextRequest } from "next/server";
import { createConsumerServerClient } from "@/lib/supabase/server-client";

export async function GET(request:NextRequest) {
  const code=request.nextUrl.searchParams.get("code");
  let next=request.nextUrl.searchParams.get("next") ?? "/portfolio";
  if(!next.startsWith("/")) next="/portfolio";

  if(code){
    const supabase=await createConsumerServerClient();
    const {error}=await supabase.auth.exchangeCodeForSession(code);
    if(!error){
      const forwardedHost=request.headers.get("x-forwarded-host");
      const origin=request.nextUrl.origin;
      if(process.env.NODE_ENV==="development") return NextResponse.redirect(origin+next);
      if(forwardedHost) return NextResponse.redirect("https://"+forwardedHost+next);
      return NextResponse.redirect(origin+next);
    }
  }

  return NextResponse.redirect(new URL("/login?error=confirm",request.url));
}
