import { createBrowserClient } from "@supabase/ssr";

function publicConfig() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!key) throw new Error("Supabase public configuration is missing.");
  return{url,key};
}

export function createConsumerBrowserClient() {
  const {url,key}=publicConfig();
  return createBrowserClient(url,key);
}
