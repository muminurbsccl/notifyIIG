import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const crypto = await import("@/lib/notifications/target-crypto");

describe("target encryption keys", () => {
  const raw = "0123456789abcdef0123456789abcdef";
  const base64 = Buffer.from(raw, "utf8").toString("base64");

  it.each([raw, base64])("round-trips with a supported key representation", (key) => {
    const encrypted = crypto.encryptTarget("https://discord.com/api/webhooks/1/secret", key);
    expect(encrypted.split(":"), "iv:tag:ciphertext").toHaveLength(3);
    expect(crypto.decryptTarget(encrypted, key)).toBe("https://discord.com/api/webhooks/1/secret");
  });

  it("rejects values that are neither raw nor base64 32-byte keys", () => {
    expect(() => crypto.encryptTarget("target", "short-key")).toThrow(
      "APP_ENCRYPTION_KEY must be exactly 32 bytes as raw text or base64",
    );
  });

  it("preserves masking behavior", () => {
    expect(crypto.maskTarget("email", "operator@example.com")).toBe("o***@example.com");
    expect(crypto.maskTarget("whatsapp", "+8801712345678")).toBe("+88***78");
  });
});
