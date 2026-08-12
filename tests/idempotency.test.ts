import { describe, expect, it } from "vitest";
import { buildIdempotencyKey, buildTargetHash } from "@/lib/domain/idempotency";

describe("delivery idempotency", () => {
  it("normalizes equivalent targets before hashing", () => {
    expect(buildTargetHash("email", " Owner@Example.test ")).toBe(
      buildTargetHash("email", "owner@example.test"),
    );
    expect(buildTargetHash("email", "owner@example.test")).not.toBe(
      buildTargetHash("email", "other@example.test"),
    );
  });

  it("returns the same key for the same event/channel/target", () => {
    expect(buildIdempotencyKey("event-1", "email", "owner@example.test")).toBe(
      buildIdempotencyKey("event-1", "email", " Owner@Example.test "),
    );
    expect(buildIdempotencyKey("event-1", "email", "owner@example.test")).not.toBe(
      buildIdempotencyKey("event-2", "email", "owner@example.test"),
    );
  });

  it("normalizes WhatsApp channel casing and prevents delimiter collisions", () => {
    expect(buildTargetHash("WhatsApp", "+880 1712-345-678")).toBe(
      buildTargetHash("whatsapp", "+8801712345678"),
    );
    expect(buildIdempotencyKey("e", "x:y", "z")).not.toBe(
      buildIdempotencyKey("e:x", "y", "z"),
    );
  });
});
