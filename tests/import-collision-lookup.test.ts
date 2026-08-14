import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { findExistingImportCandidateKeys } from "@/lib/data";

describe("import collision lookup", () => {
  it("matches exact codes and unique names without crossing providers or archived records", async () => {
    const providerSelect = vi.fn().mockResolvedValue({ data: [
      { id: "provider-1", code: "EXACT", name: "Exact Provider" },
      { id: "provider-2", code: "STORED_NAME", name: "Name Fallback" },
      { id: "provider-3", code: "OTHER", name: "Other Provider" },
      { id: "provider-4", code: "AMBIG_A", name: "Ambiguous" },
      { id: "provider-5", code: "AMBIG_B", name: "Ambiguous" },
    ], error: null });
    const neq = vi.fn().mockResolvedValue({ data: [
      { provider_id: "provider-1", normalized_circuit_id: "C-1", status: "active" },
      { provider_id: "provider-2", normalized_circuit_id: "C-2", status: "draft" },
      { provider_id: "provider-3", normalized_circuit_id: "C-9", status: "active" },
    ], error: null });
    const secondIn = vi.fn().mockReturnValue({ neq }); const firstIn = vi.fn().mockReturnValue({ in: secondIn });
    const circuitSelect = vi.fn().mockReturnValue({ in: firstIn });
    const supabase = { from: vi.fn((table: string) => ({ select: table === "providers" ? providerSelect : circuitSelect })) } as never;
    const primary = (normalizedValue: string) => [{ normalizedValue, primary: true }];
    const keys = await findExistingImportCandidateKeys(supabase, [
      { candidateKey: "EXACT:C-1", providerCode: "EXACT", providerName: "Exact Provider", identifiers: primary("C-1") },
      { candidateKey: "GENERATED:C-2", providerCode: "GENERATED", providerName: "Name Fallback", identifiers: primary("C-2") },
      { candidateKey: "OTHER:C-1", providerCode: "OTHER", providerName: "Other Provider", identifiers: primary("C-1") },
      { candidateKey: "GENERATED:C-3", providerCode: "GENERATED", providerName: "Ambiguous", identifiers: primary("C-3") },
    ]);
    expect(keys).toEqual(new Set(["EXACT:C-1", "GENERATED:C-2"]));
    expect(neq).toHaveBeenCalledWith("status", "archived");
  });
});
