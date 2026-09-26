import assert from "node:assert/strict";
import {
  resolveDataEndpoint,
  resolveAuthEndpoint,
  isLocalBridgeEndpoint,
} from "../lib/auth-endpoints.mjs";

const CLOUD_URL = "https://hmfrlpsjszjpvzogrico.supabase.co";
const CLOUD_ANON = "cloud-anon-key";
const LOCAL_URL = "http://127.0.0.1:54321";
const LOCAL_KEY = "local-dev-only";

// 1. Auth resolves cloud URL + anon key.
assert.deepEqual(
  resolveAuthEndpoint({
    NEXT_PUBLIC_SUPABASE_URL: CLOUD_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: CLOUD_ANON,
  }),
  { url: CLOUD_URL, key: CLOUD_ANON },
);

// 2. Auth NEVER returns the local bridge, even when local env is set.
assert.equal(
  resolveAuthEndpoint({
    NEXT_PUBLIC_SOLPIENT_DATA_API_URL: LOCAL_URL,
    NEXT_PUBLIC_SOLPIENT_DATA_API_KEY: LOCAL_KEY,
  }),
  null,
);

// 3. Auth prefers cloud when BOTH local and cloud are set.
assert.deepEqual(
  resolveAuthEndpoint({
    NEXT_PUBLIC_SOLPIENT_DATA_API_URL: LOCAL_URL,
    NEXT_PUBLIC_SOLPIENT_DATA_API_KEY: LOCAL_KEY,
    NEXT_PUBLIC_SUPABASE_URL: CLOUD_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: CLOUD_ANON,
  }),
  { url: CLOUD_URL, key: CLOUD_ANON },
);

// 4. Auth falls back to server-side SUPABASE_URL / SUPABASE_ANON_KEY.
assert.deepEqual(
  resolveAuthEndpoint({ SUPABASE_URL: CLOUD_URL, SUPABASE_ANON_KEY: CLOUD_ANON }),
  { url: CLOUD_URL, key: CLOUD_ANON },
);

// 5. Auth prefers the publishable key when both key variants are set.
assert.deepEqual(
  resolveAuthEndpoint({
    NEXT_PUBLIC_SUPABASE_URL: CLOUD_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: CLOUD_ANON,
  }),
  { url: CLOUD_URL, key: "publishable" },
);

// 6. Auth returns null when the URL is present but the key is missing.
assert.equal(
  resolveAuthEndpoint({ NEXT_PUBLIC_SUPABASE_URL: CLOUD_URL }),
  null,
);

// 7. Auth returns null when the key is present but the URL is missing.
assert.equal(
  resolveAuthEndpoint({ NEXT_PUBLIC_SUPABASE_ANON_KEY: CLOUD_ANON }),
  null,
);

// 8. Data prefers the local bridge when configured.
assert.deepEqual(
  resolveDataEndpoint({
    NEXT_PUBLIC_SOLPIENT_DATA_API_URL: LOCAL_URL,
    NEXT_PUBLIC_SOLPIENT_DATA_API_KEY: LOCAL_KEY,
    NEXT_PUBLIC_SUPABASE_URL: CLOUD_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: CLOUD_ANON,
  }),
  { url: LOCAL_URL, key: LOCAL_KEY },
);

// 9. Data falls back to cloud (preserves current getSupabase() behavior).
assert.deepEqual(
  resolveDataEndpoint({
    NEXT_PUBLIC_SUPABASE_URL: CLOUD_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: CLOUD_ANON,
  }),
  { url: CLOUD_URL, key: CLOUD_ANON },
);

// 10. Data returns null when nothing is configured.
assert.equal(resolveDataEndpoint({}), null);

// 11. isLocalBridgeEndpoint detects the bridge (trailing slash tolerant).
assert.equal(
  isLocalBridgeEndpoint({ url: LOCAL_URL + "/", key: LOCAL_KEY }, { NEXT_PUBLIC_SOLPIENT_DATA_API_URL: LOCAL_URL }),
  true,
);
assert.equal(
  isLocalBridgeEndpoint({ url: CLOUD_URL, key: CLOUD_ANON }, { NEXT_PUBLIC_SOLPIENT_DATA_API_URL: LOCAL_URL }),
  false,
);
assert.equal(isLocalBridgeEndpoint(null, {}), false);

// 12. Mixed env shape: auth factory contract — auth and data never share an endpoint.
const mixed = {
  NEXT_PUBLIC_SOLPIENT_DATA_API_URL: LOCAL_URL,
  NEXT_PUBLIC_SOLPIENT_DATA_API_KEY: LOCAL_KEY,
  NEXT_PUBLIC_SUPABASE_URL: CLOUD_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: CLOUD_ANON,
};
const auth = resolveAuthEndpoint(mixed);
const data = resolveDataEndpoint(mixed);
assert.ok(auth && data);
assert.notEqual(auth.url, data.url);
assert.equal(isLocalBridgeEndpoint(auth, mixed), false);
assert.equal(isLocalBridgeEndpoint(data, mixed), true);

console.log("test-auth-endpoints: all 12 assertions passed");
