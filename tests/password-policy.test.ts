import { describe, expect, it } from "vitest";
import { validatePassword } from "@/lib/domain/password-policy";

describe("validatePassword", () => {
  it("rejects passwords shorter than 8 characters", () => {
    expect(validatePassword("Ab1!xyz")).toMatch(/at least 8/);
  });

  it("rejects common breached passwords even when long enough", () => {
    expect(validatePassword("password")).toMatch(/too common/);
    expect(validatePassword("12345678")).toMatch(/too common/);
  });

  it("rejects passwords using only a single character class", () => {
    expect(validatePassword("abcdefgh")).toMatch(/mix at least two/);
    expect(validatePassword("12345679")).toMatch(/mix at least two/); // digits-only, not in the common list
    expect(validatePassword("aaaaaaaaaa")).toMatch(/mix at least two/);
  });

  it("accepts a password mixing at least two character classes and not in the common list", () => {
    expect(validatePassword("Xk7!pqzr")).toBeNull();
    expect(validatePassword("outage2026")).toBeNull();
  });
});
