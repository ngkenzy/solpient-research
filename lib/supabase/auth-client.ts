import "server-only";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthEndpoint } from "../auth-endpoints.mjs";

/**
 * Hybrid auth-vs-data split (Worker A).
 *
 * Auth/session calls (supabase.auth.*) must ALWAYS target Supabase cloud —
 * the local PostgREST bridge is data-plane only and has no /auth/v1.
 *
 * This factory is the entry point for auth in non-SSR server contexts.
 * The SSR cookie-based paths — sign-in/sign-up in app/login/actions.ts,
 * the OAuth callback in app/auth/callback/route.ts, session reads in
 * app/login/page.tsx, and session refresh in lib/supabase/session-proxy.ts —
 * go through lib/supabase/server-client.ts and lib/supabase/session-proxy.ts,
 * which resolve the same cloud-only endpoint via resolveAuthEndpoint().
 * Every auth call therefore funnels through the one cloud-only resolver and
 * can never be pointed at the local bridge.
 *
 * Session/cookie behavior is unchanged from today: this client uses the same
 * non-persistent, non-refreshing auth config as the other factories and does
 * not introduce new cookie names or storage.
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
