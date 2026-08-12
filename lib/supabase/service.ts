import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getServerConfig } from "@/lib/server-config";

export function createServiceSupabaseClient() {
  const config = getServerConfig();
  if (!config.supabaseUrl || !config.serviceRoleKey) {
    throw new Error("Supabase service configuration is missing");
  }
  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
