import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

vi.mock("server-only", () => ({}));

import { isPreviewFresh, parseWorkbook, verifyPreviewSignature } from "@/lib/import/xlsx";
import { APPROVED_WORKBOOK_SHEET_NAMES, getWorkbookSheetAdapter } from "@/lib/import/adapters";

function workbookFile(): File {
  const workbook = XLSX.utils.book_new();
  const add = (name: string, rows: unknown[][]) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  add("Upstream (IPT)", [
    ["SL", "Customer ID", "Circuit ID", "Link Type", "Capacity", "Provider Name", "Segment", "Router", "Activation", "Expiry", "Procedure Start", "NRC", "Monthly Cost", "Remark"],
    ["1", "CUSTOMER-1", "IPT-1", "IP", "10G", "Carrier One", "International", "CORE-1", "1-Jan-30", "1-Jan-32", "1-Sep-31", "", "USD 100", ""],
  ]);
  add("Upstream (Backhaul)", [
    ["SL", "Provider ID", "BSCPLC ID", "Capacity", "Segment", "Router", "Activation", "Expiry", "Monthly Cost", "Procedure Start"],
    ["Carrier Two (Synthetic Site)"],
    ["1", "PROVIDER-2", "BSCPLC-2", "10G", "Backhaul", "CORE-2", "1-Jan-30", "1-Jan-32", "USD 200", "1-Sep-31"],
  ]);
  add("Internet Exchange", [
    ["SL", "Customer / Link ID", "Circuit ID", "Provider Name", "Service Type", "Capacity", "Activation Date", "Deactivation", "Permission Expiry", "Procedure Start", "Monthly Cost", "Remark"],
    ["1", "LINK-3", "IX-3", "Carrier Three", "Peering", "1G", "1-Jan-30", "Contract narrative", "1-Jan-32", "1-Sep-31", "USD 300", ""],
  ]);
  add("Singapore Equinix", [
    ["Service Order", "Provider Name", "Service Type", "Capacity", "Location", "Activation Date", "Expiry Date", "Monthly Cost", "Notes"],
    ["SO-4", "Equinix", "Cross Connect", "1G", "SG1", "1-Jan-30", "1-Jan-32", "USD 400", ""],
  ]);
  add("Sheet1", [["helper content"]]);
  add("Unknown Operations", [["requires review"]]);
  add("Empty Unknown", []);
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([bytes], "synthetic-import.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

describe("multi-sheet workbook orchestration", () => {
  beforeEach(() => { process.env.APP_ENCRYPTION_KEY = "synthetic-preview-signing-key"; });

  it("dispatches only the four approved sheets and reports ignored content", async () => {
    const now = new Date("2030-01-01T00:00:00.000Z");
    const preview = await parseWorkbook(workbookFile(), now);
    expect(preview.circuitCandidates).toHaveLength(4);
    expect(preview.circuitCandidates.map((candidate) => candidate.externalCircuitId).sort()).toEqual(["BSCPLC-2", "IPT-1", "IX-3", "SO-4"]);
    expect(preview.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "IGNORED_HELPER_SHEET", severity: "info", source: expect.objectContaining({ sheetName: "Sheet1" }) }),
      expect.objectContaining({ code: "UNKNOWN_WORKSHEET", severity: "warning", source: expect.objectContaining({ sheetName: "Unknown Operations" }) }),
    ]));
    expect(preview.issues.some((issue) => issue.source?.sheetName === "Empty Unknown")).toBe(false);
    expect(preview.sheetNames).toEqual(["Upstream (IPT)", "Upstream (Backhaul)", "Internet Exchange", "Singapore Equinix", "Sheet1", "Unknown Operations", "Empty Unknown"]);
    expect(preview.previewIssuedAt).toBe(now.toISOString());
    expect(preview.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.previewChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.previewSignature).toMatch(/^[a-f0-9]{64}$/);
  });

  it("signs all preview metadata and rejects stale previews", async () => {
    const issued = new Date("2030-01-01T00:00:00.000Z");
    const preview = await parseWorkbook(workbookFile(), issued);
    const verify = (overrides: Partial<typeof preview> = {}, now = new Date("2030-01-01T00:29:59.000Z")) => verifyPreviewSignature(
      overrides.previewChecksum ?? preview.previewChecksum,
      overrides.checksum ?? preview.checksum,
      overrides.previewSignature ?? preview.previewSignature,
      overrides.filename ?? preview.filename,
      overrides.sheetNames ?? preview.sheetNames,
      overrides.previewIssuedAt ?? preview.previewIssuedAt,
      now,
    );
    expect(verify()).toBe(true);
    expect(verify({ filename: "tampered.xlsx" })).toBe(false);
    expect(verify({ sheetNames: [...preview.sheetNames].reverse() })).toBe(false);
    expect(verify({ checksum: "0".repeat(64) })).toBe(false);
    expect(verify({ previewChecksum: "1".repeat(64) })).toBe(false);
    expect(verify({ previewIssuedAt: "2030-01-01T00:00:01.000Z" })).toBe(false);
    expect(isPreviewFresh(preview.previewIssuedAt, new Date("2030-01-01T00:29:59.999Z"))).toBe(true);
    expect(verify({}, new Date("2030-01-01T00:30:00.000Z"))).toBe(false);
    expect(isPreviewFresh("not-a-date", issued)).toBe(false);
    expect(isPreviewFresh("2030-01-01", issued)).toBe(false);
    expect(isPreviewFresh("2030-01-01T06:00:00.000+06:00", issued)).toBe(false);
    expect(isPreviewFresh("2030-01-01T00:00:00Z", issued)).toBe(false);
    expect(isPreviewFresh("2030-02-31T00:00:00.000Z", issued)).toBe(false);
    expect(isPreviewFresh("2030-01-01T00:00:01.000Z", issued)).toBe(false);
  });

  it("exposes an immutable exact approved-sheet allowlist", () => {
    expect(APPROVED_WORKBOOK_SHEET_NAMES).toEqual(["Upstream (IPT)", "Upstream (Backhaul)", "Internet Exchange", "Singapore Equinix"]);
    expect(Object.isFrozen(APPROVED_WORKBOOK_SHEET_NAMES)).toBe(true);
    expect(() => (APPROVED_WORKBOOK_SHEET_NAMES as unknown as string[]).push("Unexpected")).toThrow();
    expect(getWorkbookSheetAdapter("Unexpected")).toBeUndefined();
    expect(APPROVED_WORKBOOK_SHEET_NAMES.every((name) => getWorkbookSheetAdapter(name)?.sheetName === name)).toBe(true);
  });

  it("rejects workbooks without an approved sheet but preserves approved structural errors", async () => {
    const unsupported = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(unsupported, XLSX.utils.aoa_to_sheet([["helper"]]), "Sheet1");
    XLSX.utils.book_append_sheet(unsupported, XLSX.utils.aoa_to_sheet([["unknown"]]), "Unknown");
    const unsupportedBytes = XLSX.write(unsupported, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    await expect(parseWorkbook(new File([unsupportedBytes], "unsupported.xlsx"))).rejects.toMatchObject({ code: "NO_APPROVED_WORKSHEETS", status: 422 });

    const approvedEmpty = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(approvedEmpty, XLSX.utils.aoa_to_sheet([]), "Upstream (IPT)");
    const approvedBytes = XLSX.write(approvedEmpty, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const preview = await parseWorkbook(new File([approvedBytes], "approved-empty.xlsx"), new Date("2030-01-01T00:00:00.000Z"));
    expect(preview.issues).toContainEqual(expect.objectContaining({ code: "INVALID_SHEET_STRUCTURE", severity: "error" }));
  });

  it("rejects an invalid workbook payload", async () => {
    await expect(parseWorkbook(new File([new Uint8Array([1, 2, 3])], "invalid.xlsx"))).rejects.toMatchObject({ code: expect.stringMatching(/INVALID_WORKBOOK|EMPTY_WORKBOOK/) });
  });
});
