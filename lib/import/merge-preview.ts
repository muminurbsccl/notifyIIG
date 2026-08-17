import type { CircuitImportCandidate, ImportIdentifier, ImportIssue, ImportPreview, ImportProvider, ImportSource } from "@/lib/domain/workbook-import";
import type { SheetAdapterResult } from "./adapters/types";

const sourceKey = (source: ImportSource) => `${source.sheetName}\u0000${source.rowNumber.toString().padStart(9, "0")}\u0000${source.section ?? ""}`;
const uniqueSources = (sources: ImportSource[]) => [...new Map(sources.map((source) => [sourceKey(source), source])).values()].sort((a, b) => sourceKey(a).localeCompare(sourceKey(b)));
const identifierKey = (identifier: ImportIdentifier) => `${identifier.normalizedValue}\u0000${identifier.primary ? "0" : "1"}\u0000${identifier.kind}\u0000${identifier.value}`;

function cloneCandidate(candidate: CircuitImportCandidate): CircuitImportCandidate {
  return { ...candidate, identifiers: candidate.identifiers.map((identifier) => ({ ...identifier })), sources: uniqueSources(candidate.sources.map((source) => ({ ...source }))) };
}

function mergeText(first: string | null, second: string | null): string | null {
  if (!first) return second; if (!second || first === second) return first;
  return [...new Set([...first.split("\n"), ...second.split("\n")])].sort().join("\n");
}

function canonicalizeIdentifiers(identifiers: ImportIdentifier[], expectedPrimary: string, issues: ImportIssue[], source?: ImportSource): ImportIdentifier[] {
  const groups = new Map<string, ImportIdentifier[]>();
  for (const identifier of [...identifiers].sort((a, b) => identifierKey(a).localeCompare(identifierKey(b)))) {
    const group = groups.get(identifier.normalizedValue) ?? []; group.push({ ...identifier }); groups.set(identifier.normalizedValue, group);
  }
  const canonical: ImportIdentifier[] = [];
  for (const [normalizedValue, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const primaries = group.filter((identifier) => identifier.primary).sort((a, b) => identifierKey(a).localeCompare(identifierKey(b)));
    if (group.length > 1) issues.push({ code: "DUPLICATE_IDENTIFIER", severity: "warning", message: `Duplicate normalized identifier ${normalizedValue} was deduplicated`, source, value: normalizedValue });
    if (primaries.length > 1 && new Set(primaries.map((identifier) => identifier.kind)).size > 1) {
      issues.push({ code: "CONFLICTING_DUPLICATE", severity: "error", message: `Primary identifier ${normalizedValue} has incompatible kinds`, source, value: normalizedValue });
    }
    if (normalizedValue !== expectedPrimary && primaries.length > 0) {
      issues.push({ code: "CONFLICTING_DUPLICATE", severity: "error", message: `Candidate has multiple primary identifiers`, source, value: normalizedValue });
    }
    const chosen = primaries[0] ?? group[0]; canonical.push({ ...chosen, primary: normalizedValue === expectedPrimary });
  }
  return canonical;
}

export function mergeAdapterResults(results: readonly SheetAdapterResult[]): ImportPreview {
  let inputCandidateCount = 0;
  const issues: ImportIssue[] = results.flatMap((result) => result.issues.map((issue) => ({ ...issue, source: issue.source ? { ...issue.source } : undefined })));
  const providerMap = new Map<string, ImportProvider>();
  for (const provider of results.flatMap((result) => result.providers).sort((a, b) => `${a.code}\u0000${a.name}\u0000${sourceKey(a.sources[0])}`.localeCompare(`${b.code}\u0000${b.name}\u0000${sourceKey(b.sources[0])}`))) {
    const current = providerMap.get(provider.code);
    if (!current) providerMap.set(provider.code, { ...provider, sources: uniqueSources(provider.sources.map((source) => ({ ...source }))) });
    else {
      if (current.name !== provider.name) issues.push({ code: "CONFLICTING_DUPLICATE", severity: "error", message: `Provider ${provider.code} has conflicting names`, source: provider.sources[0] });
      current.sources = uniqueSources([...current.sources, ...provider.sources]);
    }
  }

  const groups = new Map<string, CircuitImportCandidate[]>();
  for (const candidate of results.flatMap((result) => result.circuitCandidates)) {
    const primary = [...candidate.identifiers].filter((identifier) => identifier.primary).sort((a, b) => identifierKey(a).localeCompare(identifierKey(b)))[0];
    if (!primary) { issues.push({ code: "MISSING_IDENTIFIER", severity: "error", message: "Candidate has no primary identifier", source: candidate.sources[0] }); continue; }
    inputCandidateCount += 1;
    const key = `${candidate.providerCode}:${primary.normalizedValue}`;
    const normalizedCandidate = cloneCandidate(candidate);
    normalizedCandidate.identifiers = canonicalizeIdentifiers(normalizedCandidate.identifiers, primary.normalizedValue, issues, normalizedCandidate.sources[0]);
    const group = groups.get(key) ?? []; group.push(normalizedCandidate); groups.set(key, group);
  }

  const circuitCandidates: CircuitImportCandidate[] = []; let mergedCount = 0;
  const criticalFields: (keyof CircuitImportCandidate)[] = ["serviceType", "capacity", "location", "segment", "connectedRouter", "startDate", "expiryDate", "renewalProcedureStartDate", "monthlyCost", "currency"];
  for (const [key, rawGroup] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const group = rawGroup.sort((a, b) => `${sourceKey(a.sources[0])}\u0000${JSON.stringify(a)}`.localeCompare(`${sourceKey(b.sources[0])}\u0000${JSON.stringify(b)}`));
    const merged = cloneCandidate(group[0]);
    for (const candidate of group.slice(1)) {
      mergedCount += 1;
      for (const field of criticalFields) {
        const current = merged[field]; const incoming = candidate[field];
        if (current === null && incoming !== null) (merged as unknown as Record<string, unknown>)[field] = incoming;
        else if (current !== null && incoming !== null && current !== incoming) issues.push({ code: "CONFLICTING_DUPLICATE", severity: "error", message: `${key} has conflicting ${String(field)}`, source: candidate.sources[0] });
      }
      const primary = merged.identifiers.find((identifier) => identifier.primary)!;
      merged.identifiers = canonicalizeIdentifiers([...merged.identifiers, ...candidate.identifiers], primary.normalizedValue, issues, candidate.sources[0]); merged.sources = uniqueSources([...merged.sources, ...candidate.sources]);
      merged.notes = mergeText(merged.notes, candidate.notes); merged.rawCostDetails = mergeText(merged.rawCostDetails, candidate.rawCostDetails);
      const rank = { draft: 0, expired: 1, active: 2 } as const;
      if (rank[candidate.status] > rank[merged.status]) { merged.status = candidate.status; merged.notificationEnabled = candidate.notificationEnabled; merged.ownerOverride = candidate.ownerOverride; }
    }
    circuitCandidates.push(merged);
  }
  const providers = [...providerMap.values()].sort((a, b) => a.code.localeCompare(b.code));
  const sortedIssues = issues.sort((a, b) => `${a.code}\u0000${a.severity}\u0000${a.message}\u0000${a.source ? sourceKey(a.source) : ""}\u0000${a.value ?? ""}`.localeCompare(`${b.code}\u0000${b.severity}\u0000${b.message}\u0000${b.source ? sourceKey(b.source) : ""}\u0000${b.value ?? ""}`));
  return {
    providers, circuitCandidates, issues: sortedIssues,
    summary: {
      providerCount: providers.length, inputCandidateCount, serviceCount: circuitCandidates.length,
      activeCount: circuitCandidates.filter((candidate) => candidate.status === "active").length,
      expiredCount: circuitCandidates.filter((candidate) => candidate.status === "expired").length,
      draftCount: circuitCandidates.filter((candidate) => candidate.status === "draft").length, mergedCount,
    },
  };
}
