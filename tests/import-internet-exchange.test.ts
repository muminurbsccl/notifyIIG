import { describe, expect, it } from "vitest";
import { internetExchangeAdapter } from "@/lib/import/adapters/internet-exchange";

const header = ["SL", "Customer / Link ID", "Circuit ID", "Provider Name", "Service Type", "Capacity", "Activation Date", "Deactivation", "Permission Expiry", "Procedure Start", "Monthly Cost", "Remark"];

describe("Internet Exchange sheet adapter", () => {
  it("uses permission expiry and preserves deactivation narrative", () => {
    const result = internetExchangeAdapter.parse({ name: "Internet Exchange", rows: [header,
      ["1", "CUSTOMER-LINK-1", "CIRCUIT-IX-1", "Synthetic Exchange", "Peering", "10G", "1-Jan-30", "Contract continues month wise", "1-Jan-32", "1-Sep-31", "USD 400", "Invented note"],
    ] }, "2030-01-01");
    expect(result.circuitCandidates[0]).toMatchObject({
      externalCircuitId: "CIRCUIT-IX-1", expiryDate: "2032-01-01", status: "active",
      notificationEnabled: true, ownerOverride: "BSCPLC IIG Support",
      notes: "Deactivation: Contract continues month wise\nInvented note",
    });
    expect(result.circuitCandidates[0].identifiers).toEqual([
      expect.objectContaining({ kind: "circuit", value: "CIRCUIT-IX-1", primary: true }),
      expect.objectContaining({ kind: "customer_link", value: "CUSTOMER-LINK-1", primary: false }),
    ]);
    expect(result.issues).toEqual([]);
  });

  it("does not infer dates from narrative and reports independent row errors", () => {
    const result = internetExchangeAdapter.parse({ name: "Internet Exchange", rows: [header,
      ["1", "", "", "", "Peering", "10G", "bad-date", "Renew for 12 months", "also-bad", "", "USD 100; SGD 200", "", "unknown"],
    ] }, "2030-01-01");
    expect(result.circuitCandidates).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "MISSING_PROVIDER", "MISSING_IDENTIFIER", "INVALID_DATE", "COMPOUND_COST", "UNMAPPED_CELL",
    ]));
    expect(result.issues.filter((issue) => issue.code === "INVALID_DATE")).toHaveLength(2);
  });

  it("recognizes data without numeric serials and reports repeated headers", () => {
    const result = internetExchangeAdapter.parse({ name: "Internet Exchange", rows: [header,
      header,
      ["", "LINK-BLANK", "CIRCUIT-BLANK", "Synthetic Exchange", "Peering", "1G", "1-Jan-30", "", "1-Jan-32"],
      ["not-a-number", "LINK-TEXT", "CIRCUIT-TEXT", "Synthetic Exchange", "Peering", "1G", "1-Jan-30", "", "1-Jan-32"],
    ] }, "2030-01-01");
    expect(result.circuitCandidates.map((candidate) => candidate.externalCircuitId)).toEqual(["CIRCUIT-BLANK", "CIRCUIT-TEXT"]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "REPEATED_HEADER", source: expect.objectContaining({ rowNumber: 2 }) }));
  });

  it("classifies expired and incomplete permission records safely", () => {
    const result = internetExchangeAdapter.parse({ name: "Internet Exchange", rows: [header,
      ["1", "", "CIRCUIT-OLD", "Synthetic Exchange", "Peering", "1G", "1-Jan-28", "", "1-Jan-29"],
      ["2", "", "CIRCUIT-DRAFT", "Synthetic Exchange", "Peering", "1G", "1-Jan-30", "Contract narrative", ""],
    ] }, "2030-01-01");
    expect(result.circuitCandidates[0]).toMatchObject({ status: "expired", notificationEnabled: false, ownerOverride: null });
    expect(result.circuitCandidates[1]).toMatchObject({ status: "draft", notificationEnabled: false, ownerOverride: null });
  });

  it("parses the real operator workbook layout with section heading and full column set", () => {
    const realHeader = ["Sl. No.", "Link Name /Customer ID", "Circuit ID", "Link Type", "Capacity", "Provider Name", "Segment name", "Connected Router", "Activation Date", "Deactivation Date", "Permission Expiry Date", "Monthly MRC\n(in USD)", "Starting Date renewal or termination procedure"];
    const result = internetExchangeAdapter.parse({ name: "Internet Exchange", rows: [realHeader,
      ["Singapore Internet Exchange (SGIX) @ Singapore", "", "", "", "", "", "", "", "", "", "", "", ""],
      ["1", "SGIX000191\nUEN : 200916410W", "103.16.102.141", "IP Port", "100 G", "Singapore Internet Exchange", "SMW5", "EQ-01", "20-Apr-26", "Minimum contract years 1 year (intial term) and increase month wise. Central Bank permission is taken up to 19 April 2027", "19-Apr-27", "MRC: 1800 SGD", "20-Dec-26"],
    ] }, "2026-08-17");
    expect(result.circuitCandidates).toHaveLength(1);
    expect(result.circuitCandidates[0]).toMatchObject({
      externalCircuitId: "103.16.102.141", providerCode: "SGIX", providerName: "Singapore Internet Exchange",
      serviceType: "IP Port", capacity: "100 G", segment: "SMW5", connectedRouter: "EQ-01",
      startDate: "2026-04-20", expiryDate: "2027-04-19", renewalProcedureStartDate: "2026-12-20",
      monthlyCost: 1800, currency: "SGD", status: "active",
      notificationEnabled: true, ownerOverride: "BSCPLC IIG Support",
    });
    expect(result.circuitCandidates[0].identifiers).toEqual([
      expect.objectContaining({ kind: "circuit", value: "103.16.102.141", primary: true }),
      expect.objectContaining({ kind: "customer_link", value: "SGIX000191", primary: false }),
    ]);
    expect(result.issues).toEqual([]);
  });
});
