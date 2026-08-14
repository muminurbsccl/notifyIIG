import { describe, expect, it } from "vitest";
import { upstreamIptAdapter } from "@/lib/import/adapters/upstream-ipt";

const header = ["Sl. No.", "Link Name /Customer ID", "Circuit ID", "Link Type", "Capacity", "Provider Name", "Segment name", "Connected Router", "Activation Date", "Deactivation Date", "Starting Date renewal or termination procedure", "NRC", "Monthly MRC", "Remark"];

describe("IP Transit sheet adapter", () => {
  it("maps an explicit provider and complete circuit as active", () => {
    const result = upstreamIptAdapter.parse({ name: "Upstream (IPT)", rows: [
      ["Synthetic transit inventory"], header,
      ["1", "CUSTOMER-A", "CIRCUIT-A", "IP Port", "40G", "Example Carrier", "Site A", "CORE-A", "15-Sep-30", "14-Sep-31", "15-May-31", "USD 0", "USD 777", "Synthetic record"],
    ] }, "2030-01-01");
    expect(result.issues).toEqual([]);
    expect(result.circuitCandidates[0]).toMatchObject({
      providerCode: "EXAMPLE_CARRIER", externalCircuitId: "CIRCUIT-A",
      serviceType: "IP Port", capacity: "40G", segment: "Site A", connectedRouter: "CORE-A",
      startDate: "2030-09-15", expiryDate: "2031-09-14", renewalProcedureStartDate: "2031-05-15",
      monthlyCost: 777, currency: "USD", status: "active", notificationEnabled: true,
      ownerOverride: "BSCPLC IIG Support",
    });
  });

  it("warns for compound cost and errors for missing ID or contradictory dates", () => {
    const result = upstreamIptAdapter.parse({ name: "Upstream (IPT)", rows: [header,
      ["1", "", "", "IP Port", "10G", "Carrier A"],
      ["2", "", "CIRCUIT-B", "IP Port", "10G", "Carrier A", "", "", "15-Sep-31", "14-Sep-30", "", "", "Committed USD 500; burstable USD 100"],
    ] }, "2030-01-01");
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "MISSING_IDENTIFIER", "CONTRADICTORY_DATES", "COMPOUND_COST",
    ]));
  });

  it("collects independent row diagnostics and honors explicit provider over headings", () => {
    const result = upstreamIptAdapter.parse({ name: "Upstream (IPT)", rows: [header,
      ["Conflicting Heading"],
      ["1", "", "", "IP Port", "10G", "Explicit Carrier", "", "", "bad-date", "14-Sep-31", "15-Sep-32", "", "Committed USD 500; burstable USD 100", "", "unexpected"],
      ["2", "", "CIRCUIT-C", "IP Port", "10G", "Explicit Carrier", "", "", "15-Sep-30", "14-Sep-31", "15-Sep-32"],
    ] }, "2030-01-01");
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "MISSING_IDENTIFIER", "INVALID_DATE", "CONTRADICTORY_DATES", "COMPOUND_COST", "UNMAPPED_CELL",
    ]));
    expect(result.circuitCandidates[0].providerName).toBe("Explicit Carrier");
  });
});
