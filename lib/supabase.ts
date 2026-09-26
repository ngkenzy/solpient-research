import { createClient } from "@supabase/supabase-js";
import { resolveDataEndpoint } from "./auth-endpoints.mjs";

/**
 * Data-plane client: queries the local PostgREST bridge when configured,
 * falling back to Supabase cloud until the local migration is proven
 * (see docs/local-first-migration.md Phase 4).
 *
 * This client NEVER performs auth calls. For any supabase.auth.* usage
 * (sign-in/sign-up/sign-out/session), use createAuthServerClient() from
 * ./supabase/auth-client.ts, which always targets Supabase cloud — the
 * local bridge has no /auth/v1.
 */
export function getSupabase() {
  const endpoint = resolveDataEndpoint(process.env);
  if (!endpoint) return null;

  return createClient(endpoint.url, endpoint.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
