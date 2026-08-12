export type RetryClassification = {
  kind: "transient" | "permanent";
  retryable: boolean;
  delaySeconds: number;
  reason: string;
};

export const MAX_DELIVERY_RETRIES = 3;

export function classifyDeliveryError(
  status: number | null,
  message: string,
  attempts = 0,
): RetryClassification {
  const safeAttempts = Number.isFinite(attempts) ? Math.max(0, Math.floor(attempts)) : 0;
  const transient =
    status === null || status === 408 || status === 429 || (status >= 500 && status <= 599);
  if (!transient) {
    return {
      kind: "permanent",
      retryable: false,
      delaySeconds: 0,
      reason: message || "Permanent channel failure",
    };
  }

  const delaySeconds = [60, 300, 900][Math.min(safeAttempts, 2)];
  return {
    kind: "transient",
    retryable: safeAttempts < MAX_DELIVERY_RETRIES,
    delaySeconds,
    reason: message || "Transient channel failure",
  };
}
