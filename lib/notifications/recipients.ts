export const MANDATORY_SUPPORT_EMAIL = "support.iig@bsccl.com";

export type EmailRecipientInput = {
  active: boolean;
  type?: string;
  contact_type?: string;
  email?: string | null;
  id?: string;
};

export type EmailRoutingSettings = {
  emailEnabled: boolean;
  explicitTo?: unknown[];
};

export function canonicalEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function buildEmailTargets(
  settings: EmailRoutingSettings,
  contacts: EmailRecipientInput[] = [],
): string[] {
  const targets = new Map<string, string>();

  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    const canonical = canonicalEmailAddress(value);
    if (!canonical.includes("@")) return;
    targets.set(canonical, canonical);
  };

  add(MANDATORY_SUPPORT_EMAIL);

  if (settings.emailEnabled === false) {
    return [...targets.keys()];
  }

  const explicitTo = Array.isArray(settings.explicitTo) ? settings.explicitTo : [];
  const explicitContactIds = new Set<string>();

  for (const entry of explicitTo) {
    if (typeof entry !== "string") continue;

    const canonical = canonicalEmailAddress(entry);
    if (canonical.includes("@")) {
      add(canonical);
      continue;
    }

    explicitContactIds.add(canonical);
  }

  const hasExplicitContacts = explicitContactIds.size > 0;

  for (const contact of contacts) {
    const recipientType = canonicalEmailAddress(contact.type ?? contact.contact_type ?? "");
    if (contact.active !== true || recipientType !== "recipient") {
      continue;
    }
    if (
      hasExplicitContacts &&
      (typeof contact.id !== "string" || !explicitContactIds.has(contact.id.toLowerCase().trim()))
    ) {
      continue;
    }

    if (typeof contact.email === "string") {
      add(contact.email);
    }
  }

  return [...targets.keys()];
}
