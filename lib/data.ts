import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/auth";
import { canAccessProvider } from "@/lib/auth";
import { normalizeCircuitId } from "@/lib/validation";

export type ProviderRecord = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  default_responsible_officer: string | null;
  primary_owner_user_id: string | null;
  backup_owner_user_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CircuitRecord = {
  id: string;
  provider_id: string;
  external_circuit_id: string;
  normalized_circuit_id: string;
  identifier_type: "circuit" | "link" | "durable";
  service_type: string | null;
  capacity: string | null;
  location: string | null;
  start_date: string | null;
  expiry_date: string | null;
  expiry_version: number;
  status: string;
  action_status: string;
  owner_user_id: string | null;
  owner_override: string | null;
  backup_owner_user_id: string | null;
  monthly_cost: number | null;
  currency: string | null;
  notes: string | null;
  notification_enabled: boolean;
  notification_rule_id: string | null;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
};

export async function listProviders(
  supabase: SupabaseClient,
  search?: string,
): Promise<ProviderRecord[]> {
  let query = supabase.from("providers").select("*").order("name");
  if (search?.trim()) query = query.ilike("name", `%${search.trim()}%`);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ProviderRecord[];
}

export async function listCircuits(
  supabase: SupabaseClient,
  filters: { search?: string; providerId?: string; status?: string },
): Promise<CircuitRecord[]> {
  let query = supabase.from("circuits").select("*").order("expiry_date", { ascending: true, nullsFirst: false });
  if (filters.search?.trim()) query = query.ilike("external_circuit_id", `%${filters.search.trim()}%`);
  if (filters.providerId) query = query.eq("provider_id", filters.providerId);
  if (filters.status) query = query.eq("status", filters.status);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as CircuitRecord[];
}

export async function findExistingImportCandidateKeys(
  supabase: SupabaseClient,
  candidates: readonly { candidateKey: string; providerCode: string; providerName: string; identifiers: readonly { normalizedValue: string; primary: boolean }[] }[],
): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();
  const normalizedValues = [...new Set(candidates.flatMap((candidate) => candidate.identifiers.filter((identifier) => identifier.primary).map((identifier) => identifier.normalizedValue)))];
  const { data: providers, error: providerError } = await supabase.from("providers").select("id,code,name");
  if (providerError) throw providerError;
  const providerByCode = new Map((providers ?? []).map((provider) => [String(provider.code), String(provider.id)]));
  const providersByName = new Map<string, string[]>();
  for (const provider of providers ?? []) {
    const key = String(provider.name).toUpperCase(); const matches = providersByName.get(key) ?? []; matches.push(String(provider.id)); providersByName.set(key, matches);
  }
  const candidateProvider = new Map<string, string>();
  for (const candidate of candidates) {
    const exact = providerByCode.get(candidate.providerCode); const nameMatches = providersByName.get(candidate.providerName.toUpperCase()) ?? [];
    const providerId = exact ?? (nameMatches.length === 1 ? nameMatches[0] : undefined);
    if (providerId) candidateProvider.set(candidate.candidateKey, providerId);
  }
  const providerIds = [...new Set(candidateProvider.values())];
  if (providerIds.length === 0 || normalizedValues.length === 0) return new Set();
  const { data: circuits, error: circuitError } = await supabase.from("circuits").select("provider_id,normalized_circuit_id,status")
    .in("provider_id", providerIds).in("normalized_circuit_id", normalizedValues).neq("status", "archived");
  if (circuitError) throw circuitError;
  const existingPairs = new Set((circuits ?? []).map((circuit) => `${String(circuit.provider_id)}:${String(circuit.normalized_circuit_id)}`));
  return new Set(candidates.filter((candidate) => {
    const providerId = candidateProvider.get(candidate.candidateKey); const primary = candidate.identifiers.find((identifier) => identifier.primary);
    return Boolean(providerId && primary && existingPairs.has(`${providerId}:${primary.normalizedValue}`));
  }).map((candidate) => candidate.candidateKey));
}

export async function getCircuit(
  supabase: SupabaseClient,
  profile: Profile,
  id: string,
): Promise<CircuitRecord | null> {
  const { data, error } = await supabase.from("circuits").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return canAccessProvider(profile, data.provider_id) ? (data as CircuitRecord) : null;
}

export function toCircuitRow(input: Record<string, unknown>, verifiedBy: string | null, verifiedAt: string | null) {
  return {
    provider_id: input.providerId,
    external_circuit_id: input.externalCircuitId,
    normalized_circuit_id: normalizeCircuitId(String(input.externalCircuitId)),
    identifier_type: input.identifierType,
    service_type: input.serviceType ?? null,
    capacity: input.capacity ?? null,
    location: input.location ?? null,
    start_date: input.startDate ?? null,
    expiry_date: input.expiryDate ?? null,
    status: input.status,
    action_status: input.actionStatus,
    owner_user_id: input.ownerUserId ?? null,
    owner_override: input.ownerOverride ?? null,
    backup_owner_user_id: input.backupOwnerUserId ?? null,
    monthly_cost: input.monthlyCost ?? null,
    currency: input.currency ?? null,
    notes: input.notes ?? null,
    notification_enabled: input.notificationEnabled,
    notification_rule_id: input.notificationRuleId ?? null,
    verified_by: verifiedBy,
    verified_at: verifiedAt,
  };
}
