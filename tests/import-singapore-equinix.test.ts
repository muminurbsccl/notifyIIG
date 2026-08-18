import { describe, expect, it } from "vitest";
import { singaporeEquinixAdapter } from "@/lib/import/adapters/singapore-equinix";
import { mergeAdapterResults } from "@/lib/import/merge-preview";

const serviceHeader = ["Service Order", "Provider Name", "Service Type", "Capacity", "Location", "Activation Date", "Expiry Date", "Monthly Cost", "Notes"];
const billingHeader = ["Service Order", "Provider Name", "Monthly Cost"];

describe("Singapore Equinix sheet adapter", () => {
  it("keeps multiline service orders as one service with searchable alternates", () => {
    const result = singaporeEquinixAdapter.parse({ name: "Singapore Equinix", rows: [serviceHeader,
      ["SO-100\nso-100\nPORT-ALT-100", "Equinix", "Cross Connect", "10G", "SG1", "1-Jan-30", "1-Jan-32", "", "Invented service"],
    ] }, "2030-01-01");
    expect(result.circuitCandidates).toHaveLength(1);
    expect(result.circuitCandidates[0]).toMatchObject({ externalCircuitId: "SO-100", serviceType: "Cross Connect", status: "active" });
    expect(result.circuitCandidates[0].identifiers).toEqual([
      expect.objectContaining({ kind: "service_order", value: "SO-100", primary: true }),
      expect.objectContaining({ kind: "alternate", value: "PORT-ALT-100", primary: false }),
    ]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "DUPLICATE_IDENTIFIER" }));
    expect(result.circuitCandidates[0]).toMatchObject({ notificationEnabled: true, ownerOverride: "BSCPLC IIG Support" });
  });

  it("enriches from billing and continuation rows while retaining two lineage entries", () => {
    const parsed = singaporeEquinixAdapter.parse({ name: "Singapore Equinix", rows: [serviceHeader,
      ["SO-200", "Equinix", "Cross Connect", "10G", "SG1", "1-Jan-30", "1-Jan-32", "", ""],
      [], billingHeader,
      ["SO-200", "Equinix", ""],
      ["", "", "USD 725"],
    ] }, "2030-01-01");
    const preview = mergeAdapterResults([parsed]);
    expect(preview.circuitCandidates).toHaveLength(1);
    expect(preview.circuitCandidates[0]).toMatchObject({ monthlyCost: 725, currency: "USD", status: "active" });
    expect(preview.circuitCandidates[0].sources.map((source) => source.rowNumber)).toEqual([2, 5]);
    expect(preview.summary.mergedCount).toBe(1);
  });

  it("keeps a billing-only service without expiry as a disabled draft", () => {
    const parsed = singaporeEquinixAdapter.parse({ name: "Singapore Equinix", rows: [billingHeader,
      ["SO-DRAFT", "Equinix", "USD 300"],
    ] }, "2030-01-01");
    expect(parsed.circuitCandidates[0]).toMatchObject({
      externalCircuitId: "SO-DRAFT", status: "draft", notificationEnabled: false, ownerOverride: null,
    });
  });

  it("does not treat ambiguous billing rows as continuations", () => {
    const parsed = singaporeEquinixAdapter.parse({ name: "Singapore Equinix", rows: [billingHeader,
      ["SO-PARENT", "Equinix", ""],
      ["", "Another Provider", "USD 900", "unexpected"],
    ] }, "2030-01-01");
    expect(parsed.circuitCandidates[0].monthlyCost).toBeNull();
    expect(parsed.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["MISSING_IDENTIFIER", "UNMAPPED_CELL"]));
  });

  it("reports strict row diagnostics and classifies expired services", () => {
    const extendedHeader = [...serviceHeader, "Mystery"];
    const parsed = singaporeEquinixAdapter.parse({ name: "Singapore Equinix", rows: [extendedHeader,
      ["SO-OLD", "Equinix", "Cross Connect", "1G", "SG1", "1-Jan-28", "1-Jan-29"],
      ["SO-REVERSED", "Equinix", "Cross Connect", "1G", "SG1", "2-Jan-31", "1-Jan-31"],
      ["", "Equinix", "Cross Connect", "1G", "SG1", "bad-date", "also-bad", "", "", "unexpected"],
    ] }, "2030-01-01");
    expect(parsed.circuitCandidates[0]).toMatchObject({ status: "expired", notificationEnabled: false, ownerOverride: null });
    expect(parsed.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "CONTRADICTORY_DATES", "MISSING_IDENTIFIER", "INVALID_DATE", "UNMAPPED_CELL",
    ]));
  });

  it("parses the real operator workbook two-section layout and merges matching serials", () => {
    const realServiceHeader = ["SL", "Type of Service", "Service Order No with price in USD", "Order Validity", "Deactivation Date", "Starting Date renewal or termination procedure"];
    const realBillingHeader = ["Sl No", "Circuit Serial No", "Description", "Activation Date", "NRC (USD)", "MRC (USD)", "Remark"];
    const parsed = singaporeEquinixAdapter.parse({ name: "Singapore Equinix", rows: [
      realServiceHeader,
      ["1", "BDREN Cross Connect", "1-246460244684 (314 USD)", "19 Feb 2025 to 18 Feb 2026\nFor any discontinuation, we have to inform them before 3 months of the validity", "18-Feb-27", "21-Oct-26"],
      ["4", "2X100 GE EIE Port", "1-250112313476 (6300 USD)- Newly Signed SO", "01 Sep 2025 to 31 Aug 2026\nFor any discontinuation, we have to inform them before 3 months of the validity", "31-Aug-26", "3-May-26"],
      realBillingHeader,
      ["1", "1-218045771258", "Twenty cross connect MRC", "1-Aug-22", "", "5,232.00", "Renew for 2 yrs"],
      ["3", "1-250112313476", "Equinix Internet Exchange -Remorte Port-2x100GE MRC", "1-Aug-22", "", "6,300.00", "Renew for 2 yrs"],
      ["4", "1-216640819808", "Rackspace", "1-Jun-22", "", "1,155.00", "Renew for 2 yrs"],
      ["", "", "AC Power", "", "", "1,306.93", ""],
    ] }, "2026-08-17");
    const preview = mergeAdapterResults([parsed]);
    const bySerial = new Map(preview.circuitCandidates.map((candidate) => [candidate.externalCircuitId, candidate]));
    expect(bySerial.get("1-250112313476")).toMatchObject({
      providerCode: "EQUINIX", monthlyCost: 6300, currency: "USD",
      expiryDate: "2026-08-31", renewalProcedureStartDate: "2026-05-03", status: "active",
      startDate: "2022-08-01", notes: expect.stringContaining("01 Sep 2025 to 31 Aug 2026"),
    });
    expect(bySerial.get("1-218045771258")).toMatchObject({
      monthlyCost: 5232, currency: "USD", startDate: "2022-08-01", status: "draft",
      notes: expect.stringContaining("Twenty cross connect MRC"),
    });
    const rackspace = bySerial.get("1-216640819808");
    expect(rackspace).toMatchObject({ monthlyCost: 1155, currency: "USD", status: "draft" });
    expect(rackspace!.notes).toContain("AC Power");
    expect(rackspace!.notes).not.toContain("1,306.93");
    expect(preview.circuitCandidates.filter((candidate) => candidate.externalCircuitId === "1-246460244684")).toHaveLength(1);
    expect(preview.circuitCandidates.find((candidate) => candidate.externalCircuitId === "1-246460244684")).toMatchObject({
      serviceType: "BDREN Cross Connect", expiryDate: "2027-02-18", renewalProcedureStartDate: "2026-10-21", status: "active",
    });
    expect(parsed.issues.map((issue) => issue.code)).not.toEqual(expect.arrayContaining(["INVALID_SHEET_STRUCTURE"]));
  });
});
