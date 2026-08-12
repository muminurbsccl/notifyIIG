import { describe, expect, it } from "vitest";
import { resolveSetting, selectEligibleRecipients } from "@/lib/domain/routing";

describe("notification routing", () => {
  it("resolves the most specific non-null setting", () => {
    expect(resolveSetting("circuit", "provider", "global")).toEqual({
      value: "circuit",
      source: "circuit",
    });
    expect(resolveSetting(null, "provider", "global")).toEqual({
      value: "provider",
      source: "provider",
    });
    expect(resolveSetting(null, null, "global")).toEqual({
      value: "global",
      source: "global",
    });
    expect(resolveSetting(null, null, null)).toEqual({
      value: null,
      source: "none",
    });
  });

  it("filters inactive and non-opted-in WhatsApp recipients", () => {
    expect(
      selectEligibleRecipients([
        { channel: "email", target: "owner@example.test", active: true },
        { channel: "whatsapp", target: "+8801712345678", active: true, optedIn: true },
        { channel: "whatsapp", target: "+8801712345679", active: true, optedIn: false },
        { channel: "whatsapp", target: "+8801712345680", active: true },
        { channel: "email", target: "   ", active: true },
        { channel: "discord", target: "https://discord.example/webhook", active: false },
      ]),
    ).toEqual([
      { channel: "email", target: "owner@example.test", active: true },
      { channel: "whatsapp", target: "+8801712345678", active: true, optedIn: true },
    ]);
  });
});
