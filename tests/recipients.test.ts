import { describe, expect, it } from "vitest";
import { buildEmailTargets, MANDATORY_SUPPORT_EMAIL, canonicalEmailAddress } from "@/lib/notifications/recipients";

describe("email recipient routing", () => {
  it("always includes mandatory support as the base target", () => {
    expect(buildEmailTargets({ emailEnabled: false, explicitTo: [] }, [])).toEqual([
      MANDATORY_SUPPORT_EMAIL,
    ]);
  });

  it("adds enabled explicit recipients and active provider recipients when enabled", () => {
    const contacts = [
      {
        id: "id-1",
        active: true,
        type: "recipient",
        email: "person@example.com",
      },
      {
        id: "id-2",
        active: true,
        type: "recipient",
        email: "other@example.com",
      },
    ];

    expect(
      buildEmailTargets(
        {
          emailEnabled: true,
          explicitTo: [" SUPPORT.IIG@BSCCL.COM ", "person@example.com", "id-2"],
        },
        contacts,
      ),
    ).toEqual([MANDATORY_SUPPORT_EMAIL, "person@example.com", "other@example.com"]);
  });

  it("ignores inactive contacts and excludes unknown explicit ids", () => {
    const contacts = [
      {
        id: "id-1",
        active: false,
        type: "recipient",
        email: "inactive@example.com",
      },
      {
        id: "id-2",
        active: true,
        type: "recipient",
        email: "active@example.com",
      },
    ];

    expect(
      buildEmailTargets({ emailEnabled: true, explicitTo: ["id-1", "id-2", "id-missing"] }, contacts),
    ).toEqual([MANDATORY_SUPPORT_EMAIL, "active@example.com"]);
  });

  it("deduplicates email targets case-insensitively", () => {
    expect(
      buildEmailTargets(
        {
          emailEnabled: true,
          explicitTo: ["John@Example.com", " john@example.COM ", "jane@example.com"],
        },
        [],
      ),
    ).toEqual([MANDATORY_SUPPORT_EMAIL, "john@example.com", "jane@example.com"]);
  });

  it("normalizes email values consistently", () => {
    expect(canonicalEmailAddress("  Support.IIG@BSCCL.COM  ")).toBe("support.iig@bsccl.com");
  });
});
