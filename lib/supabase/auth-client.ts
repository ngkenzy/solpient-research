import "server-only";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthEndpoint } from "../auth-endpoints.mjs";

/**
 * Hybrid auth-vs-data split (Worker A).
 *
 * Auth/session calls (supabase.auth.*) must ALWAYS target Supabase cloud —
 * the local PostgREST bridge is data-plane only and has no /auth/v1.
 * This factory is the single entry point for any current or future
 * sign-in/sign-up/sign-out/getUser/getSession/getClaims call site
 * (e.g. a future app/login/actions.ts).
 *
 * Session/cookie behavior is unchanged from today: this client uses the same
 * non-persistent, non-refreshing auth config as the other factories and does
 * not introduce new cookie names or storage. When SSR cookie-based session
 * handling is added later, it must be wired through this factory so the
 * endpoint stays cloud while cookies stay the same.
 */
export function createAuthServerClient() {
  const endpoint = resolveAuthEndpoint(process.env);
  if (!endpoint) return null;

  return createClient(endpoint.url, endpoint.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/** True when cloud auth env is configured (Supabase URL + anon key). */
export function authServerConfigured() {
  return resolveAuthEndpoint(process.env) !== null;
}
