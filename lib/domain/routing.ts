export type ResolutionSource = "circuit" | "provider" | "global" | "none";

export type ResolvedSetting<T> = {
  value: T | null;
  source: ResolutionSource;
};

export type Recipient = {
  channel: "email" | "whatsapp" | "discord";
  target: string;
  active: boolean;
  optedIn?: boolean;
};

export function resolveSetting<T>(
  circuit: T | null | undefined,
  provider: T | null | undefined,
  global: T | null | undefined,
): ResolvedSetting<T> {
  if (circuit !== null && circuit !== undefined) {
    return { value: circuit, source: "circuit" };
  }
  if (provider !== null && provider !== undefined) {
    return { value: provider, source: "provider" };
  }
  if (global !== null && global !== undefined) {
    return { value: global, source: "global" };
  }
  return { value: null, source: "none" };
}

export function selectEligibleRecipients(recipients: Recipient[]): Recipient[] {
  return recipients.filter((recipient) => {
    if (!recipient.active || recipient.target.trim() === "") {
      return false;
    }
    return recipient.channel !== "whatsapp" || recipient.optedIn === true;
  });
}
