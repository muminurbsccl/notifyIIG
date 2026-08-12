import { createBrowserClient } from "@supabase/ssr";
import { getPublicConfig } from "@/lib/config";

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

export function createBrowserSupabaseClient() {
  if (browserClient) return browserClient;
  const config = getPublicConfig();
  if (!config.configured || !config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error("Supabase public configuration is missing");
  }
  browserClient = createBrowserClient(config.supabaseUrl, config.supabaseAnonKey);
  return browserClient;
}
