import "server-only";

type Entry = { value: unknown; expiresAt: number };

const store = new Map<string, Entry>();
const MAX_ENTRIES = 500;

/**
 * Tiny in-process TTL cache for reference data.
 * Callers must include every authorization-relevant dimension (e.g. profile
 * id) in the key because RLS output differs per user; values are never shared
 * across keys. The map is bounded: exceeding MAX_ENTRIES clears it entirely,
 * which is safe (cache miss) and keeps memory flat on long-lived instances.
 */
export async function ttlCache<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;
  const value = await loader();
  if (store.size >= MAX_ENTRIES) store.clear();
  store.set(key, { value, expiresAt: now + ttlMs });
  return value;
}
