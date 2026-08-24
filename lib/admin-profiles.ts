import "server-only";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { ttlCache } from "@/lib/server/ttl-cache";

export type ActiveProfileOption = { id: string; email: string | null; full_name: string; role: string };

// Admin-only selector data used for owner pickers; a short TTL smooths rapid
// navigation without meaningfully delaying visibility of newly activated users.
export function listActiveProfiles(): Promise<ActiveProfileOption[]> {
  return ttlCache("active-profiles", 15_000, async () => {
    const { data, error } = await createServiceSupabaseClient()
      .from("profiles")
      .select("id,email,full_name,role")
      .eq("active", true)
      .order("full_name");
    if (error) throw error;
    return (data ?? []) as ActiveProfileOption[];
  });
}
