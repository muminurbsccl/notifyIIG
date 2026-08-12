import { createHash } from "node:crypto";

function normalizeTarget(channel: string, target: string): string {
  const trimmed = target.trim();
  if (channel.toLowerCase() === "whatsapp") {
    return trimmed.replace(/[^+\d]/g, "");
  }
  return trimmed.toLowerCase();
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function buildTargetHash(channel: string, target: string): string {
  return digest(JSON.stringify([channel.toLowerCase(), normalizeTarget(channel, target)]));
}

export function buildIdempotencyKey(
  eventId: string,
  channel: string,
  target: string,
): string {
  return digest(
    JSON.stringify([eventId, channel.toLowerCase(), normalizeTarget(channel, target)]),
  );
}
