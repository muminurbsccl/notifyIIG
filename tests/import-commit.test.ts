import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiProfile: vi.fn(),
  computePreviewChecksum: vi.fn(),
  verifyPreviewSignature: vi.fn(),
  serviceRpc: vi.fn(),
  sessionRpc: vi.fn(),
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
vi.mock("@/lib/import/xlsx", () => ({
  computePreviewChecksum: mocks.computePreviewChecksum,
  verifyPreviewSignature: mocks.verifyPreviewSignature,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabaseClient: () => ({ rpc: mocks.serviceRpc }),
}));

const { POST: commitImport } = await import("@/app/api/import/commit/route");

const actorId = "00000000-0000-0000-0000-000000000001";
const previewChecksum = "a".repeat(64);
const fileChecksum = "b".repeat(64);
const validCounts = {
  createdCircuits: 1,
  skippedCircuits: 0,
  mergedCircuits: 0,
  versionedCircuits: 0,
  invoiceCount: 0,
};
const preview = {
  providers: [{ name: "Example Provider", code: "EXAMPLE_PROVIDER", source: { sheetName: "Sheet1", rowNumber: 1 } }],
  circuitCandidates: [{
    providerName: "Example Provider",
    externalCircuitId: "CIRCUIT-1",
    identifierType: "circuit" as const,
    source: { sheetName: "Sheet1", rowNumber: 2 },
  }],
  invoiceReferences: [],
  issues: [],
};

function request() {
  return new Request("http://localhost/api/import/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      filename: "reviewed.xlsx",
      checksum: fileChecksum,
      previewChecksum,
      previewSignature: "c".repeat(64),
      sheetNames: ["Sheet1"],
      preview,
      decisions: {},
    }),
  });
}

describe("import commit service boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiProfile.mockResolvedValue({
      user: { id: actorId },
      profile: { role: "admin" },
      supabase: { rpc: mocks.sessionRpc },
    });
    mocks.computePreviewChecksum.mockReturnValue(previewChecksum);
    mocks.verifyPreviewSignature.mockReturnValue(true);
    mocks.serviceRpc.mockResolvedValue({
      data: { batchId: "00000000-0000-0000-0000-000000000002", counts: validCounts },
      error: null,
    });
  });

  it("commits through the server service client with the authenticated actor", async () => {
    const response = await commitImport(request());

    expect(response.status).toBe(200);
    expect(mocks.sessionRpc).not.toHaveBeenCalled();
    expect(mocks.serviceRpc).toHaveBeenCalledWith("commit_import_batch", {
      p_actor_user_id: actorId,
      p_filename: "reviewed.xlsx",
      p_checksum: fileChecksum,
      p_sheet_names: ["Sheet1"],
      p_preview: preview,
      p_decisions: {},
    });
    expect(mocks.verifyPreviewSignature).toHaveBeenCalledWith(previewChecksum, fileChecksum, "c".repeat(64), "reviewed.xlsx", ["Sheet1"]);
  });

  it("returns a safe 422 when the database retains a rejected batch", async () => {
    mocks.serviceRpc.mockResolvedValue({
      data: { status: "rejected", batchId: "00000000-0000-0000-0000-000000000002" },
      error: null,
    });

    const response = await commitImport(request());

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: {
        code: "IMPORT_COMMIT_REJECTED",
        message: "The import was rejected; review the workbook and try again",
      },
      batchId: "00000000-0000-0000-0000-000000000002",
      issues: [],
    });
  });

  it("allowlists the successful commit response", async () => {
    mocks.serviceRpc.mockResolvedValue({
      data: {
        batchId: "00000000-0000-0000-0000-000000000002",
        counts: validCounts,
        secretLikeField: "must not leave the server",
      },
      error: null,
    });

    const response = await commitImport(request());

    expect(await response.json()).toEqual({
      batchId: "00000000-0000-0000-0000-000000000002",
      counts: validCounts,
      issues: [],
    });
  });

  it("rejects malformed count objects before returning a commit response", async () => {
    mocks.serviceRpc.mockResolvedValue({
      data: {
        batchId: "00000000-0000-0000-0000-000000000002",
        counts: { ...validCounts, nested: { privateValue: "hidden" } },
      },
      error: null,
    });

    const response = await commitImport(request());

    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty("nested");
  });
});
