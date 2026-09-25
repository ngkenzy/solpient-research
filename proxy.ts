import { type NextRequest } from "next/server";
import { updateConsumerSession } from "@/lib/supabase/session-proxy";

export async function proxy(request:NextRequest) {
  return updateConsumerSession(request);
}

export const config={
  matcher:[
    "/login",
    "/auth/:path*",
    "/portfolio/:path*",
  ],
};
