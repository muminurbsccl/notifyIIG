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
});
