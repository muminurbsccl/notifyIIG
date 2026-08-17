export type CanonicalProvider = { code: string; name: string };

const aliases: Record<string, CanonicalProvider> = {
  "singapore internet exchange": { code: "SGIX", name: "Singapore Internet Exchange" },
  sgix: { code: "SGIX", name: "Singapore Internet Exchange" },
  "ti sparkle": { code: "TIS", name: "TI Sparkle" },
  tis: { code: "TIS", name: "TI Sparkle" },
};

export function canonicalProviderCode(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function resolveCanonicalProvider(
  rawHeading: string,
  explicitProvider?: string,
): CanonicalProvider | null {
  const source = (explicitProvider?.trim() || rawHeading.replace(/\s*\([^)]*\)\s*$/, "").trim());
  if (!source) return null;
  const alias = aliases[source.toLowerCase()];
  return alias ?? { code: canonicalProviderCode(source), name: source };
}
