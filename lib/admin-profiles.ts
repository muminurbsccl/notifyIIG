import "server-only";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export type ActiveProfileOption = { id: string; email: string | null; full_name: string; role: string };

export async function listActiveProfiles(): Promise<ActiveProfileOption[]> {
  const { data, error } = await createServiceSupabaseClient()
    .from("profiles")
    .select("id,email,full_name,role")
    .eq("active", true)
    .order("full_name");
  if (error) throw error;
  return (data ?? []) as ActiveProfileOption[];
}
