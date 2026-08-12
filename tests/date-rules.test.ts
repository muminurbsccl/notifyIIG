import { describe, expect, it } from "vitest";
import {
  buildMilestones,
  calculateInitialReminder,
  getDhakaBusinessDate,
} from "@/lib/domain/date-rules";

describe("expiry date rules", () => {
  it("subtracts four calendar months with end-of-month handling", () => {
    expect(calculateInitialReminder("2026-08-31")).toBe("2026-04-30");
    expect(calculateInitialReminder("2028-02-29")).toBe("2027-10-29");
    expect(calculateInitialReminder("2027-05-31")).toBe("2027-01-31");
  });

  it("uses the Dhaka business date at UTC boundaries", () => {
    expect(getDhakaBusinessDate(new Date("2026-08-02T18:30:00.000Z"))).toBe(
      "2026-08-03",
    );
    expect(getDhakaBusinessDate(new Date("2026-08-03T18:00:00.000Z"))).toBe(
      "2026-08-04",
    );
  });

  it("generates deterministic calendar and day-offset milestones", () => {
    expect(
      buildMilestones("2026-08-31", [
        { key: "T-4M", label: "Initial reminder", monthsBefore: 4 },
        { key: "T-30D", label: "Urgent reminder", daysBefore: 30 },
      ]),
    ).toEqual([
      { key: "T-4M", label: "Initial reminder", dueDate: "2026-04-30" },
      { key: "T-30D", label: "Urgent reminder", dueDate: "2026-08-01" },
    ]);
  });
});
