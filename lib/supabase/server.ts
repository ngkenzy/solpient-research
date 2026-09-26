import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { resolveAuthEndpoint } from "../auth-endpoints.mjs";

/**
 * Hybrid auth-vs-data split: server-side consumer factory. The endpoint
 * resolves through resolveAuthEndpoint(), which is cloud-only by
 * construction — auth can never be pointed at the local PostgREST bridge
 * (it has no /auth/v1). SSR cookie behavior is unchanged.
 */
export async function createConsumerServerClient() {
  const endpoint = resolveAuthEndpoint(process.env);
  if (!endpoint) throw new Error("Supabase auth configuration is missing.");

  const cookieStore = await cookies();

  return createServerClient(endpoint.url, endpoint.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet, _headers) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies. proxy.ts refreshes sessions.
        }
      },
    },
  });
}
