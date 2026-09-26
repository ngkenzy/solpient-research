/**
 * Type declarations for the pure endpoint resolvers (see auth-endpoints.mjs).
 *
 * The runtime module is plain JavaScript (importable from .ts, .mjs, and the
 * Next.js edge runtime alike); this file gives TypeScript the shapes.
 * Keep in sync with lib/auth-endpoints.mjs by hand.
 */

export interface AuthDataEndpoint {
  url: string;
  key: string;
}

/** Local PostgREST bridge first, Supabase cloud fallback. Null when unconfigured. */
export function resolveDataEndpoint(
  env?: Record<string, string | undefined>,
): AuthDataEndpoint | null;

/**
 * Supabase cloud ONLY — local bridge vars are deliberately absent, so this
 * can never return the data bridge. Null when unconfigured.
 */
export function resolveAuthEndpoint(
  env?: Record<string, string | undefined>,
): AuthDataEndpoint | null;

/** True when the endpoint is the local PostgREST bridge. */
export function isLocalBridgeEndpoint(
  endpoint: AuthDataEndpoint | null,
  env?: Record<string, string | undefined>,
): boolean;
