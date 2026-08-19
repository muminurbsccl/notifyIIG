import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { toCommitPayload } from "@/components/import-workflow";
import { importCommitSchema } from "@/lib/validation";

// The exact shape /api/import/preview returns, including previewIssuedAt.
// The candidate satisfies importCandidateSchema's lifecycle invariants
// (status draft -> no expiry, notifications off, no owner override).
const serverPreview = {
  filename: "Database_Upstream2026-8-1.xlsx",
  checksum: "a".repeat(64),
  previewChecksum: "b".repeat(64),
  previewSignature: "c".repeat(64),
  previewIssuedAt: "2026-08-19T00:00:00.000Z",
  sheetNames: ["IP Transit", "Backhaul"],
  providers: [{ name: "NTT", code: "NTT", sources: [{ sheetName: "IP Transit", rowNumber: 3 }] }],
  circuitCandidates: [
    {
      candidateKey: "NTT:USID-300381",
      providerCode: "NTT",
      providerName: "NTT",
      externalCircuitId: "USID-300381",
      identifierType: "durable",
      identifiers: [{ kind: "circuit", value: "USID-300381", normalizedValue: "USID-300381", primary: true }],
      serviceType: "IPT",
      capacity: "100M",
      location: "Dhaka",
      segment: null,
      connectedRouter: null,
      startDate: "2026-01-01",
      expiryDate: null,
      renewalProcedureStartDate: null,
      monthlyCost: 100,
      currency: "USD",
      rawCostDetails: null,
      notes: null,
      status: "draft",
      notificationEnabled: false,
      ownerOverride: null,
      sources: [{ sheetName: "IP Transit", rowNumber: 4 }],
    },
  ],
  issues: [],
  summary: { providerCount: 1, inputCandidateCount: 1, serviceCount: 1, activeCount: 0, expiredCount: 0, draftCount: 1, mergedCount: 0 },
};

describe("import commit payload contract", () => {
  it("produces a payload the server commit schema accepts", () => {
    const payload = toCommitPayload(serverPreview, {});
    const result = importCommitSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("keeps transport fields at the top level and out of preview", () => {
    const payload = toCommitPayload(serverPreview, {});
    expect(payload.previewIssuedAt).toBe(serverPreview.previewIssuedAt);
    expect(payload.preview).not.toHaveProperty("previewIssuedAt");
    expect(payload.preview).not.toHaveProperty("filename");
  });

  it("regression: leaving previewIssuedAt nested inside preview fails validation", () => {
    const { previewIssuedAt, filename, checksum, previewChecksum, previewSignature, sheetNames, ...previewData } = serverPreview;
    const broken = { filename, checksum, previewChecksum, previewSignature, sheetNames, preview: { ...previewData, previewIssuedAt }, decisions: {} };
    expect(importCommitSchema.safeParse(broken).success).toBe(false);
  });
});