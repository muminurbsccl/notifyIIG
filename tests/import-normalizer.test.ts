import { describe, expect, it } from "vitest";
import { normalizeWorkbookRows } from "@/lib/domain/import-normalizer";

describe("workbook normalization", () => {
  it("separates durable circuit IDs from invoice-only rows", () => {
    const preview = normalizeWorkbookRows([
      ["Provider", "Circuit/Link ID", "Invoice No."],
      ["NTT", "USID-300381", "INV-1"],
      ["COGENT", "", "INV-2"],
    ]);

    expect(preview.circuitCandidates.map((candidate) => candidate.externalCircuitId)).toEqual([
      "USID-300381",
    ]);
    expect(preview.circuitCandidates[0]).not.toHaveProperty("rawRow");
    expect(preview.invoiceReferences.map((reference) => reference.referenceNumber)).toEqual([
      "INV-1",
      "INV-2",
    ]);
    expect(preview.invoiceReferences[0]).not.toHaveProperty("rawRow");
    expect(preview.circuitCandidates.some((candidate) => candidate.externalCircuitId === "INV-2")).toBe(false);
    expect(preview.issues.some((issue) => issue.code === "INVOICE_ONLY")).toBe(true);
  });

  it("flags ambiguous bundle text and duplicate durable identifiers", () => {
    const preview = normalizeWorkbookRows([
      ["Provider", "Circuit/Link ID", "Invoice No."],
      ["HE", "IP/LAG bundle text", ""],
      ["NTT", "USID-300381", ""],
      ["NTT", "USID-300381", ""],
    ]);

    expect(preview.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["AMBIGUOUS_IDENTIFIER", "DUPLICATE_IDENTIFIER"]),
    );
    expect(preview.circuitCandidates.map((candidate) => candidate.externalCircuitId)).toEqual([
      "USID-300381",
      "USID-300381",
    ]);
    expect(preview.circuitCandidates[1].duplicate).toBe(true);
  });

  it("uses canonical whitespace when classifying duplicate identifiers", () => {
    const preview = normalizeWorkbookRows([
      ["Provider", "Circuit/Link ID"],
      ["NTT", "USID   300381"],
      ["NTT", "USID 300381"],
    ]);

    expect(preview.circuitCandidates[1].duplicate).toBe(true);
    expect(preview.issues.find((issue) => issue.code === "DUPLICATE_IDENTIFIER")?.decisionKey).toBe("NTT:USID 300381");
  });

  it("retains provider headings and source row lineage", () => {
    const preview = normalizeWorkbookRows([
      ["NTT"],
      ["Circuit/Link ID", "Invoice No."],
      ["USID-300381", "INV-1"],
    ]);

    expect(preview.providers[0].name).toBe("NTT");
    expect(preview.circuitCandidates[0].source.rowNumber).toBe(3);
  });

  it("does not import the narrative second sheet", () => {
    const preview = normalizeWorkbookRows(
      [["DE-CIX Mumbai peering notes"], ["IP/LAG bundle text"]],
      "Sheet2",
    );

    expect(preview.circuitCandidates).toEqual([]);
    expect(preview.issues[0].code).toBe("UNSUPPORTED_SHEET");
  });

  it("recognizes vendor and circuit-link-identifier aliases", () => {
    const preview = normalizeWorkbookRows([
      ["Vendor", "Circuit/Link Identifier"],
      ["NTT", "INV123"],
    ]);

    expect(preview.circuitCandidates).toEqual([]);
    expect(preview.issues[0].code).toBe("INVOICE_ONLY");
  });
});
