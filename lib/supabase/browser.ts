import { createBrowserClient } from "@supabase/ssr";
import { resolveAuthEndpoint } from "../auth-endpoints.mjs";

/**
 * Hybrid auth-vs-data split: browser consumer factory. The endpoint resolves
 * through resolveAuthEndpoint(), which is cloud-only by construction — auth
 * can never be pointed at the local PostgREST bridge (it has no /auth/v1).
 */
export function createConsumerBrowserClient() {
  const endpoint = resolveAuthEndpoint(process.env);
  if (!endpoint) throw new Error("Supabase auth configuration is missing.");
  return createBrowserClient(endpoint.url, endpoint.key);
}
