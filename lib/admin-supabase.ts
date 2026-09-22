import "server-only";
import { createClient } from "@supabase/supabase-js";

function adminDataApiUrl() {
  return (
    process.env.SOLPIENT_ADMIN_DATA_API_URL ??
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SOLPIENT_DATA_API_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL
  );
}

function adminDataApiKey() {
  return (
    process.env.SOLPIENT_ADMIN_DATA_API_KEY ??
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SOLPIENT_DATA_API_KEY
  );
}

export function getAdminSupabase() {
  const url = adminDataApiUrl();
  const secret = adminDataApiKey();
  if (!url || !secret) return null;

  return createClient(url, secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function adminSupabaseConfigured() {
  return Boolean(adminDataApiUrl() && adminDataApiKey());
}
