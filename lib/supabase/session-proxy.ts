import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { resolveAuthEndpoint } from "../auth-endpoints.mjs";

export async function updateConsumerSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Cloud-only by construction: session refresh is an auth call (getClaims)
  // and must never target the local PostgREST bridge (see lib/auth-endpoints.mjs).
  const endpoint = resolveAuthEndpoint(process.env);
  if (!endpoint) throw new Error("Supabase auth configuration is missing.");

  const supabase = createServerClient(endpoint.url, endpoint.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([header, value]) => response.headers.set(header, value));
      },
    },
  });

  await supabase.auth.getClaims();
  return response;
}
