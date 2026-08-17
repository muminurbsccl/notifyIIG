import { describe, expect, it } from "vitest";
import { upstreamBackhaulAdapter } from "@/lib/import/adapters/upstream-backhaul";

const header = ["Sl. No.", "Provider ID", "BSCPLC ID", "Capacity", "Segment name", "Connected Router", "Activation Date", "Deactivation Date", "Monthly MRC", "Starting Date renewal or termination procedure"];

describe("Backhaul sheet adapter", () => {
  it("uses BSCPLC ID as primary and provider ID as alternate", () => {
    const result = upstreamBackhaulAdapter.parse({ name: "Upstream (Backhaul)", rows: [header,
      ["Example Carrier (Site A)"],
      ["1", "PROVIDER-1", "INTERNAL-1", "100G", "Segment A", "CORE-A", "1-Jan-30", "31-Dec-31", "USD 888", "1-Sep-31"],
    ] }, "2030-01-01");
    expect(result.circuitCandidates[0]).toMatchObject({
      providerCode: "EXAMPLE_CARRIER", providerName: "Example Carrier", location: "Site A",
      externalCircuitId: "INTERNAL-1", status: "active",
    });
    expect(result.circuitCandidates[0].identifiers).toEqual([
      expect.objectContaining({ kind: "bscplc", value: "INTERNAL-1", primary: true }),
      expect.objectContaining({ kind: "provider", value: "PROVIDER-1", primary: false }),
    ]);
  });

  it("falls back to provider ID when BSCPLC ID is blank", () => {
    const result = upstreamBackhaulAdapter.parse({ name: "Upstream (Backhaul)", rows: [header,
      ["Example Carrier (Site B)"],
      ["1", "PROVIDER-2", "", "10G", "Segment B", "CORE-B", "1-Feb-30", "1-Feb-31", "USD 222", "1-Oct-30"],
    ] }, "2030-01-01");
    expect(result.circuitCandidates[0].externalCircuitId).toBe("PROVIDER-2");
    expect(result.circuitCandidates[0].identifiers).toEqual([
      expect.objectContaining({ kind: "provider", primary: true }),
    ]);
  });

  it("uses a registered alias and collects complete row diagnostics", () => {
    const result = upstreamBackhaulAdapter.parse({ name: "Upstream (Backhaul)", rows: [header,
      ["TI Sparkle (Synthetic Site)"],
      ["1", "", "", "10G", "Segment", "CORE", "bad-date", "1-Feb-31", "Committed USD 300; burstable USD 50", "2-Feb-31", "unexpected"],
      ["2", "PROVIDER-3", "INTERNAL-3", "10G", "Segment", "CORE", "1-Feb-30", "1-Feb-31", "USD 300", "2-Feb-31"],
    ] }, "2030-01-01");
    expect(result.providers[0]).toMatchObject({ code: "TIS", name: "TI Sparkle" });
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "MISSING_IDENTIFIER", "INVALID_DATE", "CONTRADICTORY_DATES", "COMPOUND_COST", "UNMAPPED_CELL",
    ]));
  });

  it("rejects equal and reversed activation-expiry boundaries", () => {
    const result = upstreamBackhaulAdapter.parse({ name: "Upstream (Backhaul)", rows: [header,
      ["Synthetic Carrier"],
      ["1", "PROVIDER-EQUAL", "INTERNAL-EQUAL", "10G", "Segment", "CORE", "1-Feb-31", "1-Feb-31"],
      ["2", "PROVIDER-REVERSED", "INTERNAL-REVERSED", "10G", "Segment", "CORE", "2-Feb-31", "1-Feb-31"],
    ] }, "2030-01-01");
    expect(result.issues.filter((issue) => issue.code === "CONTRADICTORY_DATES").map((issue) => issue.source?.rowNumber)).toEqual([3, 4]);
  });
});
