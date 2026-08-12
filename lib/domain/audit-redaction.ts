const SENSITIVE_KEY = /(secret|token|password|api[_-]?key|webhook|ciphertext|bcc|service.?role.?key|encryption.?key|^key$)/i;
const SENSITIVE_URL = /https?:\/\/[^\s"'<>]+/g;

export function redactAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactAuditValue(child),
      ]),
    );
  }
  return value;
}

export function redactFailureMessage(
  message: string,
  secrets: ReadonlyArray<string | null | undefined> = [],
): string {
  let redacted = message.replace(SENSITIVE_URL, "[REDACTED]");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 8) {
      redacted = redacted.split(secret).join("[REDACTED]");
    }
  }
  return redacted;
}
