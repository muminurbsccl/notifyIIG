import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function deriveKey(encryptionKey: string): Buffer {
  const key = Buffer.from(encryptionKey, "utf8");
  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must be exactly 32 bytes");
  }
  return key;
}

export function encryptTarget(plaintext: string, encryptionKey: string): string {
  const key = deriveKey(encryptionKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString("base64"))
    .join(":");
}

export function decryptTarget(payload: string, encryptionKey: string): string {
  const key = deriveKey(encryptionKey);
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted target payload");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[0], "base64"));
  decipher.setAuthTag(Buffer.from(parts[1], "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(parts[2], "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskTarget(channel: string, target: string): string {
  if (channel === "email") {
    const at = target.indexOf("@");
    if (at > 0) {
      return `${target[0]}***${target.slice(at)}`;
    }
  }
  if (channel === "whatsapp") {
    const digits = target.replace(/\D/g, "");
    if (target.startsWith("+") && digits.length >= 6) {
      return `+${digits.slice(0, 2)}***${digits.slice(-2)}`;
    }
  }
  if (target.length <= 2) return "***";
  return `${target[0]}***${target.slice(-2)}`;
}
