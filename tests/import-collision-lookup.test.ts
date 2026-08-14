import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { findExistingImportCandidateKeys } from "@/lib/data";

const candidates = [{
  candidateKey: "GENERATED:C-2", providerCode: "GENERATED", providerName: "Name Fallback",
  identifiers: [{ normalizedValue: "C-2", primary: true }],
}];

describe("import collision lookup", () => {
  it("uses one database-local resolver call and returns submitted candidate keys", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: ["GENERATED:C-2"], error: null });
    const keys = await findExistingImportCandidateKeys({ rpc } as never, candidates);
    expect(keys).toEqual(new Set(["GENERATED:C-2"]));
    expect(rpc).toHaveBeenCalledWith("find_import_collision_keys", { p_candidates: [{ candidateKey: "GENERATED:C-2", providerCode: "GENERATED", providerName: "Name Fallback", normalizedValue: "C-2" }] });
  });

  it("fails closed on resolver ambiguity or malformed RPC data", async () => {
    await expect(findExistingImportCandidateKeys({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "Provider name is ambiguous" } }) } as never, candidates)).rejects.toMatchObject({ message: "Provider name is ambiguous" });
    await expect(findExistingImportCandidateKeys({ rpc: vi.fn().mockResolvedValue({ data: { nested: "invalid" }, error: null }) } as never, candidates)).rejects.toThrow("invalid collision lookup result");
  });
});
