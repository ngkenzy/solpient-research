/**
 * Pure endpoint resolvers for the hybrid auth-vs-data architecture.
 *
 * The local PostgREST bridge (NEXT_PUBLIC_SOLPIENT_DATA_API_URL) is data-plane
 * ONLY: it exposes PostgREST, not Supabase Auth, so /auth/v1 does not exist
 * against it. Supabase Auth (supabase.auth.*) keeps going to Supabase cloud,
 * where auth MAU limits are irrelevant at this scale. Local PostgREST
 * validates cloud-issued JWTs via PGRST_JWT_SECRET (configured elsewhere).
 *
 * INVARIANT: resolveAuthEndpoint NEVER returns the local bridge URL/key.
 * These functions take an env object (defaulting to process.env) so they are
 * unit-testable without side effects.
 */

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ url: string, key: string } | null}
 */
export function resolveDataEndpoint(env = process.env) {
  const url =
    env.NEXT_PUBLIC_SOLPIENT_DATA_API_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    env.NEXT_PUBLIC_SOLPIENT_DATA_API_KEY ??
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ url: string, key: string } | null}
 */
export function resolveAuthEndpoint(env = process.env) {
  // Cloud only. Local bridge vars are deliberately absent from this list —
  // the bridge has no /auth/v1, so pointing auth at it breaks sign-in.
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
  const key =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

/**
 * @param {{ url: string, key: string } | null} endpoint
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean} true when the endpoint is the local PostgREST bridge.
 */
export function isLocalBridgeEndpoint(endpoint, env = process.env) {
  if (!endpoint) return false;
  const local = (env.NEXT_PUBLIC_SOLPIENT_DATA_API_URL ?? "").replace(/\/$/, "");
  return local !== "" && endpoint.url.replace(/\/$/, "") === local;
}
