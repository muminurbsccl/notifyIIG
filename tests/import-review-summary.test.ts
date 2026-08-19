import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ImportReviewSummary } from "@/components/import-workflow";

// Exactly the shape the /api/import/preview route returns: workbookImportPreviewSchema
// payload plus metadata. The deployed pipeline has NO invoiceReferences field.
const serverPreview = {
  filename: "Database_Upstream2026-8-1.xlsx",
  checksum: "sha256:abc",
  previewChecksum: "preview:abc",
  previewSignature: "sig:abc",
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
      identifiers: [{ type: "durable", value: "USID-300381", normalizedValue: "usid300381" }],
      sources: [{ sheetName: "IP Transit", rowNumber: 4 }],
      status: "active",
    },
  ],
  issues: [],
  summary: { providerCount: 1, inputCandidateCount: 1, serviceCount: 1, activeCount: 1, expiredCount: 0, draftCount: 0, mergedCount: 0 },
};

describe("import review summary", () => {
  it("renders a server preview payload without reading invoiceReferences", () => {
    const html = renderToString(createElement(ImportReviewSummary, { preview: serverPreview }));
    expect(html).toContain("Review before commit");
    expect(html).toContain("Circuit candidates");
    expect(html).toContain("IP Transit, Backhaul");
    expect(html).toContain("<dd>1</dd>");
    expect(html).not.toContain("Invoice references");
  });
});