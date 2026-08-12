import { describe, expect, it } from "vitest";
import { classifyDeliveryError } from "@/lib/domain/retry";

describe("delivery retry classification", () => {
  it("retries rate limits and server failures with bounded delays", () => {
    expect(classifyDeliveryError(429, "rate limited", 0).retryable).toBe(true);
    expect(classifyDeliveryError(408, "timeout", 0).delaySeconds).toBe(60);
    expect(classifyDeliveryError(500, "provider error", 1).delaySeconds).toBe(300);
    expect(classifyDeliveryError(null, "network timeout", 2).delaySeconds).toBe(900);
    expect(classifyDeliveryError(599, "provider error", 1).kind).toBe("transient");
  });

  it("stops retrying after the bounded attempt count", () => {
    expect(classifyDeliveryError(503, "provider error", 3)).toMatchObject({
      kind: "transient",
      retryable: false,
    });
    expect(classifyDeliveryError(503, "provider error", 1.5).delaySeconds).toBe(300);
  });

  it("marks client validation/configuration failures permanent", () => {
    expect(classifyDeliveryError(400, "invalid recipient")).toMatchObject({
      kind: "permanent",
      retryable: false,
    });
  });
});
