import { describe, expect, it } from "vitest";
import { cellText, headerKey, isBlankRow, splitMultiline } from "@/lib/import/cell-values";
import { parseImportCost } from "@/lib/import/costs";
import { parseWorkbookDate } from "@/lib/import/dates";
import { resolveCanonicalProvider } from "@/lib/domain/provider-aliases";
import { classifyImportLifecycle } from "@/lib/domain/workbook-import";

describe("workbook import model utilities", () => {
  it.each([
    ["15-Sep-30", "2030-09-15"],
    ["5-Jan-2031", "2031-01-05"],
    ["2032-02-29", "2032-02-29"],
  ])("parses the supported date %s without locale inference", (input, value) => {
    expect(parseWorkbookDate(input)).toEqual({ value });
  });

  it.each(["contract continues month wise", "31-Feb-30", "02/03/30", ""])(
    "rejects unsupported or invalid date %j",
    (input) => {
      expect(parseWorkbookDate(input)).toEqual({ value: null, error: "INVALID_DATE" });
    },
  );

  it("parses one unambiguous monthly cost", () => {
    expect(parseImportCost("USD 777")).toEqual({
      monthlyCost: 777,
      currency: "USD",
      rawDetails: null,
    });
    expect(parseImportCost("MRC: 1,234.50 SGD")).toEqual({
      monthlyCost: 1234.5,
      currency: "SGD",
      rawDetails: null,
    });
  });

  it("preserves compound pricing instead of inventing a total", () => {
    const raw = "Committed USD 500; burstable USD 100";
    expect(parseImportCost(raw)).toEqual({
      monthlyCost: null,
      currency: "USD",
      rawDetails: raw,
    });
  });

  it("canonicalizes an explicit provider without retaining heading location", () => {
    expect(resolveCanonicalProvider("Example Carrier (Site A)", "Example Carrier")).toEqual({
      code: "EXAMPLE_CARRIER",
      name: "Example Carrier",
    });
  });

  it("normalizes cells without retaining raw rows", () => {
    expect(cellText("  Circuit\r\n ID  ")).toBe("Circuit\n ID");
    expect(headerKey(" Circuit/Link_ID ")).toBe("circuit link id");
    expect(splitMultiline(" ID-A\r\n\r\n ID-B ")).toEqual(["ID-A", "ID-B"]);
    expect(isBlankRow(["", null, "  "])).toBe(true);
  });

  it("classifies complete future, past, and incomplete records deterministically", () => {
    expect(classifyImportLifecycle("2031-01-01", "2030-01-01")).toEqual({
      status: "active",
      notificationEnabled: true,
      ownerOverride: "BSCPLC IIG Support",
    });
    expect(classifyImportLifecycle("2029-12-31", "2030-01-01")).toEqual({
      status: "expired",
      notificationEnabled: false,
      ownerOverride: null,
    });
    expect(classifyImportLifecycle(null, "2030-01-01")).toEqual({
      status: "draft",
      notificationEnabled: false,
      ownerOverride: null,
    });
  });
});
