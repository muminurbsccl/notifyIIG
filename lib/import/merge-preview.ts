import type { CircuitImportCandidate, ImportIdentifier, ImportIssue, ImportPreview, ImportProvider, ImportSource } from "@/lib/domain/workbook-import";
import type { SheetAdapterResult } from "./adapters/types";

const sourceKey = (source: ImportSource) => `${source.sheetName}\u0000${source.rowNumber.toString().padStart(9, "0")}\u0000${source.section ?? ""}`;
const uniqueSources = (sources: ImportSource[]) => [...new Map(sources.map((source) => [sourceKey(source), source])).values()].sort((a, b) => sourceKey(a).localeCompare(sourceKey(b)));
const identifierKey = (identifier: ImportIdentifier) => `${identifier.kind}\u0000${identifier.normalizedValue}\u0000${identifier.primary ? "0" : "1"}`;
const uniqueIdentifiers = (identifiers: ImportIdentifier[]) => [...new Map(identifiers.map((identifier) => [identifierKey(identifier), identifier])).values()].sort((a, b) => identifierKey(a).localeCompare(identifierKey(b)));

function cloneCandidate(candidate: CircuitImportCandidate): CircuitImportCandidate {
  return { ...candidate, identifiers: uniqueIdentifiers(candidate.identifiers.map((identifier) => ({ ...identifier }))), sources: uniqueSources(candidate.sources.map((source) => ({ ...source }))) };
}

function mergeText(first: string | null, second: string | null): string | null {
  if (!first) return second; if (!second || first === second) return first;
  return [...new Set([...first.split("\n"), ...second.split("\n")])].join("\n");
}

export function mergeAdapterResults(results: readonly SheetAdapterResult[]): ImportPreview {
  const issues: ImportIssue[] = results.flatMap((result) => result.issues.map((issue) => ({ ...issue, source: issue.source ? { ...issue.source } : undefined })));
  const providerMap = new Map<string, ImportProvider>();
  for (const provider of results.flatMap((result) => result.providers).sort((a, b) => a.code.localeCompare(b.code))) {
    const current = providerMap.get(provider.code);
    if (!current) providerMap.set(provider.code, { ...provider, sources: uniqueSources(provider.sources.map((source) => ({ ...source }))) });
    else {
      if (current.name !== provider.name) issues.push({ code: "CONFLICTING_DUPLICATE", severity: "error", message: `Provider ${provider.code} has conflicting names`, source: provider.sources[0] });
      current.sources = uniqueSources([...current.sources, ...provider.sources]);
    }
  }

  const groups = new Map<string, CircuitImportCandidate[]>();
  for (const candidate of results.flatMap((result) => result.circuitCandidates)) {
    const primary = candidate.identifiers.find((identifier) => identifier.primary);
    if (!primary) { issues.push({ code: "MISSING_IDENTIFIER", severity: "error", message: "Candidate has no primary identifier", source: candidate.sources[0] }); continue; }
    const key = `${candidate.providerCode}:${primary.normalizedValue}`;
    const group = groups.get(key) ?? []; group.push(cloneCandidate(candidate)); groups.set(key, group);
  }

  const circuitCandidates: CircuitImportCandidate[] = []; let mergedCount = 0;
  const criticalFields: (keyof CircuitImportCandidate)[] = ["serviceType", "capacity", "location", "segment", "connectedRouter", "startDate", "expiryDate", "renewalProcedureStartDate", "monthlyCost", "currency"];
  for (const [key, rawGroup] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const group = rawGroup.sort((a, b) => sourceKey(a.sources[0]).localeCompare(sourceKey(b.sources[0])));
    const merged = cloneCandidate(group[0]);
    for (const candidate of group.slice(1)) {
      mergedCount += 1;
      for (const field of criticalFields) {
        const current = merged[field]; const incoming = candidate[field];
        if (current === null && incoming !== null) (merged as unknown as Record<string, unknown>)[field] = incoming;
        else if (current !== null && incoming !== null && current !== incoming) issues.push({ code: "CONFLICTING_DUPLICATE", severity: "error", message: `${key} has conflicting ${String(field)}`, source: candidate.sources[0] });
      }
      merged.identifiers = uniqueIdentifiers([...merged.identifiers, ...candidate.identifiers]); merged.sources = uniqueSources([...merged.sources, ...candidate.sources]);
      merged.notes = mergeText(merged.notes, candidate.notes); merged.rawCostDetails = mergeText(merged.rawCostDetails, candidate.rawCostDetails);
      const rank = { draft: 0, expired: 1, active: 2 } as const;
      if (rank[candidate.status] > rank[merged.status]) { merged.status = candidate.status; merged.notificationEnabled = candidate.notificationEnabled; merged.ownerOverride = candidate.ownerOverride; }
    }
    circuitCandidates.push(merged);
  }
  const providers = [...providerMap.values()].sort((a, b) => a.code.localeCompare(b.code));
  return {
    providers, circuitCandidates, issues,
    summary: {
      providerCount: providers.length, serviceCount: circuitCandidates.length,
      activeCount: circuitCandidates.filter((candidate) => candidate.status === "active").length,
      expiredCount: circuitCandidates.filter((candidate) => candidate.status === "expired").length,
      draftCount: circuitCandidates.filter((candidate) => candidate.status === "draft").length, mergedCount,
    },
  };
}
