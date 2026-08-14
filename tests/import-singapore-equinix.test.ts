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
});
