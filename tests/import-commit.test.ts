import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireApiProfile: vi.fn(), computePreviewChecksum: vi.fn(), verifyPreviewSignature: vi.fn(), serviceRpc: vi.fn() }));
class TestAuthError extends Error { constructor(public status: 401 | 403 | 503, message: string) { super(message); } }
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireApiProfile: mocks.requireApiProfile, AuthError: TestAuthError }));
vi.mock("@/lib/import/xlsx", () => ({ computePreviewChecksum: mocks.computePreviewChecksum, verifyPreviewSignature: mocks.verifyPreviewSignature }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabaseClient: () => ({ rpc: mocks.serviceRpc }) }));

const { POST: commitImport } = await import("@/app/api/import/commit/route");
const actorId = "00000000-0000-0000-0000-000000000001";
const batchId = "00000000-0000-4000-8000-000000000002";
const previewChecksum = "a".repeat(64); const fileChecksum = "b".repeat(64); const issuedAt = "2030-01-01T00:00:00.000Z";
const validCounts = { createdCircuits: 1, skippedCircuits: 0, mergedCircuits: 0, versionedCircuits: 0, invoiceCount: 0 };

function validPreview() {
  return {
    providers: [{ name: "Example Provider", code: "EXAMPLE_PROVIDER", sources: [{ sheetName: "Upstream (IPT)", rowNumber: 2 }] }],
    circuitCandidates: [{
      candidateKey: "EXAMPLE_PROVIDER:CIRCUIT-1", providerCode: "EXAMPLE_PROVIDER", providerName: "Example Provider",
      externalCircuitId: "CIRCUIT-1", identifierType: "circuit",
      identifiers: [
        { kind: "circuit", value: "CIRCUIT-1", normalizedValue: "CIRCUIT-1", primary: true },
        { kind: "customer_link", value: "CUSTOMER-1", normalizedValue: "CUSTOMER-1", primary: false },
      ],
      serviceType: "IP", capacity: "10G", location: null, segment: "International", connectedRouter: "CORE-1",
      startDate: "2030-01-01", expiryDate: "2032-01-01", renewalProcedureStartDate: "2031-09-01",
      monthlyCost: 100, currency: "USD", rawCostDetails: null, notes: null,
      status: "active", notificationEnabled: true, ownerOverride: "BSCPLC IIG Support",
      sources: [{ sheetName: "Upstream (IPT)", rowNumber: 2 }],
    }],
    issues: [],
    summary: { providerCount: 1, inputCandidateCount: 1, serviceCount: 1, activeCount: 1, expiredCount: 0, draftCount: 0, mergedCount: 0 },
  };
}

function request(preview = validPreview(), decisions: Record<string, "skip" | "merge" | "create"> = {}) {
  return new Request("http://localhost/api/import/commit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
    filename: "reviewed.xlsx", checksum: fileChecksum, previewChecksum, previewSignature: "c".repeat(64),
    previewIssuedAt: issuedAt, sheetNames: ["Upstream (IPT)"], preview, decisions,
  }) });
}

describe("import commit service boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiProfile.mockResolvedValue({ user: { id: actorId }, profile: { role: "admin" }, supabase: {} });
    mocks.computePreviewChecksum.mockReturnValue(previewChecksum); mocks.verifyPreviewSignature.mockReturnValue(true);
    mocks.serviceRpc.mockResolvedValue({ data: { batchId, counts: validCounts }, error: null });
  });

  it("commits a validated preview with issued-at signature binding", async () => {
    const preview = validPreview(); const response = await commitImport(request(preview));
    expect(response.status).toBe(200);
    expect(mocks.verifyPreviewSignature).toHaveBeenCalledWith(previewChecksum, fileChecksum, "c".repeat(64), "reviewed.xlsx", ["Upstream (IPT)"], issuedAt);
    expect(mocks.serviceRpc).toHaveBeenCalledWith("commit_import_batch", {
      p_actor_user_id: actorId, p_filename: "reviewed.xlsx", p_checksum: fileChecksum,
      p_sheet_names: ["Upstream (IPT)"], p_preview: preview, p_decisions: {},
    });
  });

  it.each([
    ["two primaries", (preview: ReturnType<typeof validPreview>) => { preview.circuitCandidates[0].identifiers[1].primary = true; }],
    ["display mismatch", (preview: ReturnType<typeof validPreview>) => { preview.circuitCandidates[0].externalCircuitId = "OTHER"; }],
    ["duplicate normalized alternate", (preview: ReturnType<typeof validPreview>) => { preview.circuitCandidates[0].identifiers[1].normalizedValue = "CIRCUIT-1"; }],
    ["noncanonical identifier", (preview: ReturnType<typeof validPreview>) => { preview.circuitCandidates[0].identifiers[1].normalizedValue = "customer-1"; }],
    ["reversed dates", (preview: ReturnType<typeof validPreview>) => { preview.circuitCandidates[0].startDate = "2033-01-01"; }],
    ["late procedure", (preview: ReturnType<typeof validPreview>) => { preview.circuitCandidates[0].renewalProcedureStartDate = "2033-01-01"; }],
    ["invalid lifecycle ownership", (preview: ReturnType<typeof validPreview>) => { preview.circuitCandidates[0].notificationEnabled = false; }],
    ["inconsistent summary", (preview: ReturnType<typeof validPreview>) => { preview.summary.activeCount = 0; }],
    ["understated merge count", (preview: ReturnType<typeof validPreview>) => { preview.summary.inputCandidateCount = 2; }],
    ["overstated merge count", (preview: ReturnType<typeof validPreview>) => { preview.summary.mergedCount = 1; }],
    ["undeclared provider", (preview: ReturnType<typeof validPreview>) => { preview.circuitCandidates[0].providerCode = "OTHER"; preview.circuitCandidates[0].candidateKey = "OTHER:CIRCUIT-1"; }],
    ["provider name mismatch", (preview: ReturnType<typeof validPreview>) => { preview.circuitCandidates[0].providerName = "Other Name"; }],
    ["source outside envelope", (preview: ReturnType<typeof validPreview>) => { preview.circuitCandidates[0].sources[0].sheetName = "Unknown"; }],
    ["provider source outside envelope", (preview: ReturnType<typeof validPreview>) => { preview.providers[0].sources[0].sheetName = "Unknown"; }],
  ])("rejects %s before RPC", async (_name, mutate) => {
    const preview = validPreview(); mutate(preview); const response = await commitImport(request(preview));
    expect(response.status).toBe(400); expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it("blocks error-severity preview issues before RPC", async () => {
    const preview = validPreview();
    preview.issues.push({ code: "INVALID_DATE", severity: "error", message: "Synthetic invalid date", source: { sheetName: "Upstream (IPT)", rowNumber: 2 } } as never);
    const response = await commitImport(request(preview));
    expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ error: { code: "IMPORT_PREVIEW_BLOCKED" } });
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it("rejects downgraded and misplaced issue decisions", async () => {
    const downgraded = validPreview(); downgraded.issues.push({ code: "INVALID_DATE", severity: "warning", message: "Downgraded" } as never);
    expect((await commitImport(request(downgraded))).status).toBe(400);
    const unrelated = validPreview(); unrelated.issues.push({ code: "UNMAPPED_CELL", severity: "warning", message: "Extra", decisionKey: "EXAMPLE_PROVIDER:CIRCUIT-1" } as never);
    expect((await commitImport(request(unrelated, { "EXAMPLE_PROVIDER:CIRCUIT-1": "skip" }))).status).toBe(400);
    const actionable = validPreview(); actionable.issues.push({ code: "EXISTING_RECORD_COLLISION", severity: "warning", message: "Existing record" } as never);
    expect((await commitImport(request(actionable))).status).toBe(400);
    const outside = validPreview(); outside.issues.push({ code: "UNMAPPED_CELL", severity: "warning", message: "Extra", source: { sheetName: "Unknown", rowNumber: 1 } } as never);
    expect((await commitImport(request(outside))).status).toBe(400);
  });

  it("accepts an actionable collision only with its canonical decision", async () => {
    const preview = validPreview(); preview.issues.push({ code: "EXISTING_RECORD_COLLISION", severity: "warning", message: "Existing record", decisionKey: "EXAMPLE_PROVIDER:CIRCUIT-1" } as never);
    const response = await commitImport(request(preview, { "EXAMPLE_PROVIDER:CIRCUIT-1": "merge" }));
    expect(response.status).toBe(200); expect(mocks.serviceRpc).toHaveBeenCalled();
  });

  it("rejects unknown and missing canonical decision keys", async () => {
    expect((await commitImport(request(validPreview(), { "OTHER:KEY": "skip" }))).status).toBe(400);
    const preview = validPreview(); preview.issues.push({ code: "DUPLICATE_IDENTIFIER", severity: "warning", message: "Decision", decisionKey: "EXAMPLE_PROVIDER:CIRCUIT-1" } as never);
    expect((await commitImport(request(preview))).status).toBe(400);
  });

  it("rejects changed or expired signatures before RPC", async () => {
    mocks.verifyPreviewSignature.mockReturnValue(false);
    const response = await commitImport(request());
    expect(response.status).toBe(422); expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it("checks authenticity before trusting blocking issue state", async () => {
    const preview = validPreview(); preview.issues.push({ code: "INVALID_DATE", severity: "error", message: "Tampered" } as never);
    mocks.verifyPreviewSignature.mockReturnValue(false);
    const response = await commitImport(request(preview));
    expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ error: { code: "PREVIEW_CHANGED" } });
    expect(mocks.verifyPreviewSignature).toHaveBeenCalled(); expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it("authenticates exact untrimmed signed metadata", async () => {
    mocks.verifyPreviewSignature.mockReturnValue(false);
    const payload = JSON.parse(await request().text()); payload.filename = " reviewed.xlsx"; payload.sheetNames = ["Upstream (IPT) "];
    const response = await commitImport(new Request("http://localhost/api/import/commit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
    expect(mocks.verifyPreviewSignature).toHaveBeenCalledWith(previewChecksum, fileChecksum, "c".repeat(64), " reviewed.xlsx", ["Upstream (IPT) "], issuedAt);
    expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ error: { code: "PREVIEW_CHANGED" } }); expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it("allowlists successful and rejected responses", async () => {
    mocks.serviceRpc.mockResolvedValueOnce({ data: { batchId, counts: validCounts }, error: null });
    expect(await (await commitImport(request())).json()).toEqual({ batchId, counts: validCounts });
    mocks.serviceRpc.mockResolvedValueOnce({ data: { status: "rejected", batchId, errorCode: "IMPORT_COMMIT_FAILED" }, error: null });
    expect(await (await commitImport(request())).json()).toEqual({ error: { code: "IMPORT_COMMIT_REJECTED", message: "The import was rejected; review the workbook and try again" }, batchId });
  });

  it("rejects malformed database count objects", async () => {
    mocks.serviceRpc.mockResolvedValue({ data: { batchId, counts: { ...validCounts, nested: {} } }, error: null });
    expect((await commitImport(request())).status).toBe(500);
  });

  it("rejects a malformed rejected-batch identifier without reflecting it", async () => {
    mocks.serviceRpc.mockResolvedValue({ data: { status: "rejected", batchId: { nested: "hidden" } }, error: null });
    const response = await commitImport(request()); expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("hidden");
  });

  it("rejects unknown RPC status and rejection shapes", async () => {
    mocks.serviceRpc.mockResolvedValueOnce({ data: { status: "unexpected", batchId, counts: validCounts }, error: null });
    expect((await commitImport(request())).status).toBe(500);
    mocks.serviceRpc.mockResolvedValueOnce({ data: { status: "rejected", batchId }, error: null });
    expect((await commitImport(request())).status).toBe(500);
  });

  it("rejects UUID-shaped RPC identifiers with invalid version or variant", async () => {
    const malformed = "00000000-0000-0000-0000-000000000002";
    mocks.serviceRpc.mockResolvedValueOnce({ data: { batchId: malformed, counts: validCounts }, error: null });
    expect((await commitImport(request())).status).toBe(500);
    mocks.serviceRpc.mockResolvedValueOnce({ data: { status: "rejected", batchId: malformed, errorCode: "IMPORT_COMMIT_FAILED" }, error: null });
    expect((await commitImport(request())).status).toBe(500);
  });
});
