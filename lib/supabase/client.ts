import { createBrowserClient } from "@supabase/ssr";
import { resolveAuthEndpoint } from "../auth-endpoints.mjs";

/**
 * Hybrid auth-vs-data split: resolves the cloud-only auth endpoint.
 * resolveAuthEndpoint() can never return the local PostgREST bridge
 * (it has no /auth/v1), so consumer auth always targets Supabase cloud.
 */
function authEndpoint() {
  const endpoint = resolveAuthEndpoint(process.env);
  if (!endpoint) throw new Error("Supabase auth configuration is missing.");
  return endpoint;
}

export function createConsumerBrowserClient() {
  const { url, key } = authEndpoint();
  return createBrowserClient(url, key);
}
