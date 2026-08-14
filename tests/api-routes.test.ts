import { describe, expect, it, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiProfile: vi.fn(),
  listCircuits: vi.fn(),
  toCircuitRow: vi.fn(),
  writeAudit: vi.fn(),
  parseWorkbook: vi.fn(),
  findExistingImportCandidateKeys: vi.fn(),
  computePreviewChecksum: vi.fn(),
  computePreviewSignature: vi.fn(),
}));

class TestAuthError extends Error {
  status: 401 | 403 | 503;
  constructor(status: 401 | 403 | 503, message: string) {
    super(message);
    this.status = status;
  }
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireApiProfile: mocks.requireApiProfile, AuthError: TestAuthError }));
vi.mock("@/lib/data", () => ({ listCircuits: mocks.listCircuits, toCircuitRow: mocks.toCircuitRow, findExistingImportCandidateKeys: mocks.findExistingImportCandidateKeys }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/import/xlsx", () => ({ parseWorkbook: mocks.parseWorkbook, computePreviewChecksum: mocks.computePreviewChecksum, computePreviewSignature: mocks.computePreviewSignature }));

const { POST: createCircuit } = await import("@/app/api/circuits/route");
const { POST: previewImport } = await import("@/app/api/import/preview/route");

describe("authenticated API contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiProfile.mockResolvedValue({
      user: { id: "00000000-0000-0000-0000-000000000001" },
      profile: { role: "admin" },
      supabase: {},
    });
    mocks.findExistingImportCandidateKeys.mockResolvedValue(new Set());
    mocks.computePreviewChecksum.mockReturnValue("d".repeat(64));
    mocks.computePreviewSignature.mockReturnValue("e".repeat(64));
  });

  it("returns 400 for an invalid start/expiry date order", async () => {
    const response = await createCircuit(new Request("http://localhost/api/circuits", {
      method: "POST",
      body: JSON.stringify({
        providerId: "00000000-0000-0000-0000-000000000002",
        externalCircuitId: "USID-1",
        startDate: "2026-08-31",
        expiryDate: "2026-08-01",
        status: "draft",
      }),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(400);
    expect(mocks.toCircuitRow).not.toHaveBeenCalled();
  });

  it("returns 422 when activation lacks verification and owner", async () => {
    const response = await createCircuit(new Request("http://localhost/api/circuits", {
      method: "POST",
      body: JSON.stringify({
        providerId: "00000000-0000-0000-0000-000000000002",
        externalCircuitId: "USID-1",
        expiryDate: "2026-12-31",
        status: "active",
      }),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(422);
    expect(mocks.toCircuitRow).not.toHaveBeenCalled();
  });

  it("returns a JSON 400 without writing when the import file is absent", async () => {
    const response = await previewImport(new Request("http://localhost/api/import/preview", { method: "POST" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "FILE_REQUIRED" } });
  });

  it("fails closed on malformed nested preview output", async () => {
    const normalized = {
      filename: "synthetic.xlsx", checksum: "a".repeat(64), previewChecksum: "b".repeat(64), previewSignature: "c".repeat(64),
      previewIssuedAt: "2030-01-01T00:00:00.000Z", sheetNames: ["Upstream (IPT)"],
      providers: [{ name: "Synthetic", code: "SYNTHETIC", sources: [{ sheetName: "Upstream (IPT)", rowNumber: 2, rawRow: "hidden" }], rawRow: "hidden" }],
      circuitCandidates: [{ candidateKey: "SYNTHETIC:C-1", providerCode: "SYNTHETIC", providerName: "Synthetic", externalCircuitId: "C-1", identifierType: "circuit",
        identifiers: [{ kind: "circuit", value: "C-1", normalizedValue: "C-1", primary: true, rawRow: "hidden" }], serviceType: null, capacity: null, location: null,
        segment: null, connectedRouter: null, startDate: null, expiryDate: null, renewalProcedureStartDate: null, monthlyCost: null, currency: null,
        rawCostDetails: null, notes: null, status: "draft", notificationEnabled: false, ownerOverride: null,
        sources: [{ sheetName: "Upstream (IPT)", rowNumber: 2, rawRow: "hidden" }], rawRow: "hidden" }],
      issues: [{ code: "UNMAPPED_CELL", severity: "warning", message: "Synthetic", source: { sheetName: "Upstream (IPT)", rowNumber: 2, rawRow: "hidden" }, rawRow: "hidden" }],
      summary: { providerCount: 1, inputCandidateCount: 1, serviceCount: 1, activeCount: 0, expiredCount: 0, draftCount: 1, mergedCount: 0, rawRow: "hidden" }, secretLikeField: "hidden",
    };
    mocks.parseWorkbook.mockResolvedValue(normalized);
    const form = new FormData(); form.set("file", new File([new Uint8Array([1])], "synthetic.xlsx"));
    const response = await previewImport(new Request("http://localhost/api/import/preview", { method: "POST", body: form }));
    expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain("hidden");
  });

  it("signs authenticated existing-record collisions into the returned preview", async () => {
    const normalized = {
      filename: "synthetic.xlsx", checksum: "a".repeat(64), previewChecksum: "b".repeat(64), previewSignature: "c".repeat(64), previewIssuedAt: "2030-01-01T00:00:00.000Z",
      sheetNames: ["Upstream (IPT)"], providers: [{ name: "Synthetic", code: "SYNTHETIC", sources: [{ sheetName: "Upstream (IPT)", rowNumber: 2 }] }],
      circuitCandidates: [{ candidateKey: "SYNTHETIC:C-1", providerCode: "SYNTHETIC", providerName: "Synthetic", externalCircuitId: "C-1", identifierType: "circuit",
        identifiers: [{ kind: "circuit", value: "C-1", normalizedValue: "C-1", primary: true }], serviceType: null, capacity: null, location: null, segment: null,
        connectedRouter: null, startDate: null, expiryDate: null, renewalProcedureStartDate: null, monthlyCost: null, currency: null, rawCostDetails: null, notes: null,
        status: "draft", notificationEnabled: false, ownerOverride: null, sources: [{ sheetName: "Upstream (IPT)", rowNumber: 2 }] }], issues: [],
      summary: { providerCount: 1, inputCandidateCount: 1, serviceCount: 1, activeCount: 0, expiredCount: 0, draftCount: 1, mergedCount: 0 },
    };
    mocks.parseWorkbook.mockResolvedValue(normalized); mocks.findExistingImportCandidateKeys.mockResolvedValue(new Set(["SYNTHETIC:C-1"]));
    const form = new FormData(); form.set("file", new File([new Uint8Array([1])], "synthetic.xlsx"));
    const response = await previewImport(new Request("http://localhost/api/import/preview", { method: "POST", body: form })); const body = await response.json();
    expect(body.preview.issues).toContainEqual(expect.objectContaining({ code: "EXISTING_RECORD_COLLISION", decisionKey: "SYNTHETIC:C-1" }));
    expect(body.preview.previewChecksum).toBe("d".repeat(64)); expect(body.preview.previewSignature).toBe("e".repeat(64));
  });

  it.each([
    ["filename", " synthetic.xlsx", ["Upstream (IPT)"]],
    ["sheet name", "synthetic.xlsx", ["Upstream (IPT)", " Notes "]],
  ])("rejects noncanonical parser-produced %s before signing", async (_name, filename, sheetNames) => {
    mocks.parseWorkbook.mockResolvedValue({ filename, checksum: "a".repeat(64), previewChecksum: "b".repeat(64), previewSignature: "c".repeat(64),
      previewIssuedAt: "2030-01-01T00:00:00.000Z", sheetNames, providers: [], circuitCandidates: [], issues: [],
      summary: { providerCount: 0, inputCandidateCount: 0, serviceCount: 0, activeCount: 0, expiredCount: 0, draftCount: 0, mergedCount: 0 } });
    const form = new FormData(); form.set("file", new File([new Uint8Array([1])], filename));
    const response = await previewImport(new Request("http://localhost/api/import/preview", { method: "POST", body: form }));
    expect(response.status).toBe(422); expect(mocks.computePreviewSignature).not.toHaveBeenCalled();
  });
});
