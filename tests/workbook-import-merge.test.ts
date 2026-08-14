import { describe, expect, it } from "vitest";
import type { CircuitImportCandidate } from "@/lib/domain/workbook-import";
import type { SheetAdapterResult } from "@/lib/import/adapters/types";
import { mergeAdapterResults } from "@/lib/import/merge-preview";

function candidate(overrides: Partial<CircuitImportCandidate> = {}): CircuitImportCandidate {
  return {
    candidateKey: "EXAMPLE:SO-1", providerCode: "EXAMPLE", providerName: "Example Provider",
    externalCircuitId: "SO-1", identifierType: "durable",
    identifiers: [{ kind: "service_order", value: "SO-1", normalizedValue: "SO-1", primary: true }],
    serviceType: "Cross Connect", capacity: null, location: null, segment: null, connectedRouter: null,
    startDate: null, expiryDate: "2032-01-01", renewalProcedureStartDate: null,
    monthlyCost: null, currency: null, rawCostDetails: null, notes: null,
    status: "active", notificationEnabled: true, ownerOverride: "BSCPLC IIG Support",
    sources: [{ sheetName: "Synthetic", rowNumber: 2 }], ...overrides,
  };
}

function result(circuitCandidates: CircuitImportCandidate[]): SheetAdapterResult {
  return { providers: [{ code: "EXAMPLE", name: "Example Provider", sources: [{ sheetName: "Synthetic", rowNumber: 2 }] }], circuitCandidates, issues: [] };
}

describe("workbook import merge", () => {
  it("deduplicates providers, identifiers, and compatible candidates deterministically", () => {
    const first = candidate();
    const enrichment = candidate({ monthlyCost: 500, currency: "USD", status: "draft", notificationEnabled: false, ownerOverride: null,
      identifiers: [first.identifiers[0], { kind: "alternate", value: "PORT-1", normalizedValue: "PORT-1", primary: false }],
      sources: [{ sheetName: "Synthetic", rowNumber: 8 }],
    });
    const preview = mergeAdapterResults([result([enrichment]), result([first])]);
    expect(preview.providers).toHaveLength(1);
    expect(preview.circuitCandidates).toHaveLength(1);
    expect(preview.circuitCandidates[0]).toMatchObject({ monthlyCost: 500, currency: "USD", status: "active" });
    expect(preview.circuitCandidates[0].identifiers).toHaveLength(2);
    expect(preview.circuitCandidates[0].sources.map((source) => source.rowNumber)).toEqual([2, 8]);
    expect(preview.summary).toMatchObject({ providerCount: 1, serviceCount: 1, activeCount: 1, mergedCount: 1 });
  });

  it("emits a blocking issue for conflicting non-null duplicate values", () => {
    const preview = mergeAdapterResults([result([
      candidate({ expiryDate: "2032-01-01" }),
      candidate({ expiryDate: "2033-01-01", sources: [{ sheetName: "Synthetic", rowNumber: 3 }] }),
    ])]);
    expect(preview.circuitCandidates).toHaveLength(1);
    expect(preview.issues).toContainEqual(expect.objectContaining({ code: "CONFLICTING_DUPLICATE", severity: "error" }));
  });

  it("returns the same complete preview for reversed input with tied source keys", () => {
    const first = candidate({ notes: "Alpha" });
    const second = candidate({ monthlyCost: 500, currency: "USD", notes: "Beta", status: "draft", notificationEnabled: false, ownerOverride: null });
    expect(mergeAdapterResults([result([first, second])])).toEqual(mergeAdapterResults([result([second, first])]));
  });

  it("keeps one normalized primary identifier and reports incompatible duplicate roles", () => {
    const preview = mergeAdapterResults([result([
      candidate({ identifiers: [
        { kind: "service_order", value: "SO-1", normalizedValue: "SO-1", primary: true },
        { kind: "alternate", value: "so-1", normalizedValue: "SO-1", primary: false },
      ] }),
      candidate({ identifiers: [{ kind: "circuit", value: "SO-1", normalizedValue: "SO-1", primary: true }] }),
    ])]);
    expect(preview.circuitCandidates[0].identifiers).toEqual([
      expect.objectContaining({ normalizedValue: "SO-1", primary: true }),
    ]);
    expect(preview.circuitCandidates[0].identifiers.filter((identifier) => identifier.primary)).toHaveLength(1);
    expect(preview.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["DUPLICATE_IDENTIFIER", "CONFLICTING_DUPLICATE"]));
  });
});
