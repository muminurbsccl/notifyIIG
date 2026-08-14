import { describe, expect, it } from "vitest";
import {
  authCallbackUrl,
  requireEmail,
  requirePassword,
  safeInternalDestination,
  validatedAppBaseUrl,
} from "@/lib/auth-flow";

describe("authentication flow policy", () => {
  describe("safeInternalDestination", () => {
    it("preserves an internal path with query and hash", () => {
      expect(safeInternalDestination("/dashboard?tab=due#circuit-1")).toBe(
        "/dashboard?tab=due#circuit-1",
      );
    });

    it.each([
      null,
      "",
      "dashboard",
      "https://evil.example/path",
      "//evil.example/path",
      "/\\evil.example/path",
      "/%5C%5Cevil.example/path",
      "javascript:alert(1)",
    ])("falls back for unsafe destination %j", (value) => {
      expect(safeInternalDestination(value)).toBe("/dashboard");
    });

    it("uses the caller-provided fallback", () => {
      expect(safeInternalDestination("https://evil.example", "/login")).toBe("/login");
    });

    it.each([
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/%5C%5Cevil.example",
      "/%E0%A4%A",
      "/dashboard\u0000",
    ])("uses the fixed safe default when the caller fallback is unsafe: %j", (fallback) => {
      expect(safeInternalDestination(null, fallback)).toBe("/dashboard");
    });
  });

  describe("validatedAppBaseUrl", () => {
    it("accepts the production HTTPS origin", () => {
      expect(validatedAppBaseUrl("https://notifyiig.vercel.app").toString()).toBe(
        "https://notifyiig.vercel.app/",
      );
    });

    it.each(["http://localhost:3000", "http://127.0.0.1:3000"])(
      "accepts the local development origin %s",
      (value) => {
        expect(validatedAppBaseUrl(value).origin).toBe(value);
      },
    );

    it.each([
      undefined,
      "not a URL",
      "http://notifyiig.vercel.app",
      "ftp://notifyiig.vercel.app",
      "https://evil.example",
      "https://preview.notifyiig.vercel.app",
      "https://notifyiig.vercel.app.evil.example",
      "https://notifyiig.vercel.app:444",
      "https://user:password@notifyiig.vercel.app",
      "https://notifyiig.vercel.app/path",
      "https://notifyiig.vercel.app?query=1",
      "https://notifyiig.vercel.app#fragment",
    ])("rejects an invalid application base URL %j", (value) => {
      expect(() => validatedAppBaseUrl(value)).toThrow(/APP_BASE_URL/);
    });
  });

  it("builds the PKCE callback from the validated base origin", () => {
    expect(authCallbackUrl(new URL("https://notifyiig.vercel.app"))).toBe(
      "https://notifyiig.vercel.app/auth/callback",
    );
  });

  describe("login form values", () => {
    it("normalizes a valid email address", () => {
      expect(requireEmail(" Person@Example.COM ")).toBe("person@example.com");
    });

    it.each([null, "", "person", "person@example", "person @example.com"])(
      "rejects invalid email value %j",
      (value) => {
        expect(() => requireEmail(value)).toThrow("invalid-input");
      },
    );

    it("preserves a non-empty password exactly", () => {
      expect(requirePassword(" password with spaces ")).toBe(" password with spaces ");
    });

    it.each([null, ""])("rejects invalid password value %j", (value) => {
      expect(() => requirePassword(value)).toThrow("invalid-input");
    });
  });
});
