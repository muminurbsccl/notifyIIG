import { describe, expect, it, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiProfile: vi.fn(),
  listCircuits: vi.fn(),
  toCircuitRow: vi.fn(),
  writeAudit: vi.fn(),
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
vi.mock("@/lib/data", () => ({ listCircuits: mocks.listCircuits, toCircuitRow: mocks.toCircuitRow }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));

const { POST: createCircuit } = await import("@/app/api/circuits/route");
const { POST: previewImport } = await import("@/app/api/import/preview/route");

describe("authenticated API contracts", () => {
  beforeEach(() => {
    mocks.requireApiProfile.mockResolvedValue({
      user: { id: "00000000-0000-0000-0000-000000000001" },
      profile: { role: "admin" },
      supabase: {},
    });
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
});
