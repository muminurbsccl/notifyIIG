import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEY_ERROR = "APP_ENCRYPTION_KEY must be exactly 32 bytes as raw text or base64";

export function parseEncryptionKey(value) {
  if (typeof value !== "string" || value.length === 0) throw new Error(KEY_ERROR);

  const raw = Buffer.from(value, "utf8");
  if (raw.length === 32) return raw;

  const unpadded = value.replace(/=+$/, "");
  if (!/^[A-Za-z0-9+/]+$/.test(unpadded) || value.slice(unpadded.length).length > 2) {
    throw new Error(KEY_ERROR);
  }
  if (unpadded.length % 4 === 1) throw new Error(KEY_ERROR);

  const padded = unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, "=");
  const decoded = Buffer.from(padded, "base64");
  if (decoded.length !== 32 || decoded.toString("base64").replace(/=+$/, "") !== unpadded) {
    throw new Error(KEY_ERROR);
  }
  return decoded;
}

export function encryptTargetCore(plaintext, encryptionKey) {
  const key = parseEncryptionKey(encryptionKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString("base64"))
    .join(":");
}

export function decryptTargetCore(payload, encryptionKey) {
  const key = parseEncryptionKey(encryptionKey);
  const parts = payload.split(":");
  if (parts.length !== 3) throw new Error("Malformed encrypted target payload");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[0], "base64"));
  decipher.setAuthTag(Buffer.from(parts[1], "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(parts[2], "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskTargetCore(channel, target) {
  if (channel === "email") {
    const at = target.indexOf("@");
    if (at > 0) return `${target[0]}***${target.slice(at)}`;
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
