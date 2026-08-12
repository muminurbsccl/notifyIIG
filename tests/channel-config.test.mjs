import { describe, expect, it } from "vitest";
import {
  buildChangePlan,
  formatRedactedPreview,
  parseChannelConfig,
  sanitizeError,
  validateEnvironment,
} from "../scripts/lib/channel-config.mjs";

const rawKey = "0123456789abcdef0123456789abcdef";

function validConfig() {
  return {
    version: 1,
    projectRef: "exampleprojectref123",
    actorEmail: "admin@example.com",
    providers: [{
      code: "ntt",
      contacts: [{
        key: "noc-primary", id: null, contactType: "recipient", name: "NOC Primary",
        roleTitle: "Operations", email: "NOC@Example.com", phoneE164: "+8801712345678",
        whatsappOptIn: { at: "2026-08-10T00:00:00Z", source: "written-consent" }, active: true,
      }],
      channels: {
        email: { enabled: true, to: ["noc-primary"], cc: [], bcc: [], replyTo: null, subjectPrefix: "[Expiry]", templateOverride: null },
        whatsapp: { enabled: true, recipients: ["noc-primary"], templateName: "expiry_notice" },
        discord: { enabled: false, target: null, mentionIds: [] },
      },
    }],
  };
}

function env(overrides = {}) {
  return {
    NEXT_PUBLIC_SUPABASE_URL: "https://exampleprojectref123.supabase.co",
    DATABASE_URL: "postgresql://postgres.exampleprojectref123:password@pooler.example.com:5432/postgres",
    APP_ENCRYPTION_KEY: rawKey,
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    actor: { id: "00000000-0000-0000-0000-000000000001", email: "admin@example.com", role: "admin", active: true },
    providers: [{
      id: "00000000-0000-0000-0000-000000000010", code: "NTT", name: "NTT",
      contacts: [], settings: null,
    }],
    ...overrides,
  };
}

describe("channel configuration parsing", () => {
  it("normalizes valid configuration and rejects unknown fields", () => {
    const parsed = parseChannelConfig(validConfig());
    expect(parsed.providers[0].code).toBe("NTT");
    expect(parsed.providers[0].contacts[0].email).toBe("noc@example.com");
    expect(() => parseChannelConfig({ ...validConfig(), unexpected: true })).toThrow(/unrecognized|unknown/i);
  });

  it("rejects duplicate provider codes and contact keys", () => {
    const duplicateProvider = validConfig();
    duplicateProvider.providers.push(structuredClone(duplicateProvider.providers[0]));
    expect(() => parseChannelConfig(duplicateProvider)).toThrow(/duplicate provider/i);
    const duplicateContact = validConfig();
    duplicateContact.providers[0].contacts.push(structuredClone(duplicateContact.providers[0].contacts[0]));
    expect(() => parseChannelConfig(duplicateContact)).toThrow(/duplicate contact key/i);
  });

  it("rejects duplicate normalized contact identities", () => {
    const duplicateEmail = validConfig();
    duplicateEmail.providers[0].contacts.push({
      ...structuredClone(duplicateEmail.providers[0].contacts[0]),
      key: "noc-secondary",
      email: "noc@example.com",
      phoneE164: "+8801812345678",
    });
    let emailError;
    try { parseChannelConfig(duplicateEmail); } catch (error) { emailError = error; }
    expect(emailError.message).toMatch(/duplicate email identity/i);
    expect(emailError.message).not.toContain("noc@example.com");
    const duplicatePhone = validConfig();
    duplicatePhone.providers[0].contacts.push({
      ...structuredClone(duplicatePhone.providers[0].contacts[0]),
      key: "noc-secondary",
      email: "secondary@example.com",
    });
    let phoneError;
    try { parseChannelConfig(duplicatePhone); } catch (error) { phoneError = error; }
    expect(phoneError.message).toMatch(/duplicate phone identity/i);
    expect(phoneError.message).not.toContain("+8801712345678");
  });

  it("validates project and channel environment requirements", () => {
    const config = parseChannelConfig(validConfig());
    expect(() => validateEnvironment(config, env({ DATABASE_URL: undefined }))).toThrow(/DATABASE_URL/);
    expect(() => validateEnvironment(config, env({ NEXT_PUBLIC_SUPABASE_URL: "https://wrong.supabase.co" }))).toThrow(/projectRef/i);
    const providerDiscord = validConfig();
    providerDiscord.providers[0].channels.discord = {
      enabled: true,
      target: { source: "provider", webhookUrl: "https://discord.com/api/webhooks/1/private-value" },
      mentionIds: ["123"],
    };
    expect(() => validateEnvironment(parseChannelConfig(providerDiscord), env({ APP_ENCRYPTION_KEY: "short" }))).toThrow(/32 bytes/i);
    const globalDiscord = structuredClone(providerDiscord);
    globalDiscord.providers[0].channels.discord.target = { source: "global" };
    expect(() => validateEnvironment(parseChannelConfig(globalDiscord), env({ DISCORD_WEBHOOK_URL: undefined }))).toThrow(/DISCORD_WEBHOOK_URL/);
  });

  it("rejects unsafe cross-field recipient definitions", () => {
    const missingEmail = validConfig();
    missingEmail.providers[0].contacts[0].email = null;
    expect(() => buildChangePlan(parseChannelConfig(missingEmail), snapshot(), validateEnvironment(parseChannelConfig(missingEmail), env()))).toThrow(/email/i);
    const missingOptIn = validConfig();
    missingOptIn.providers[0].contacts[0].whatsappOptIn = null;
    expect(() => buildChangePlan(parseChannelConfig(missingOptIn), snapshot(), validateEnvironment(parseChannelConfig(missingOptIn), env()))).toThrow(/opt-in/i);
    const staleEmail = validConfig();
    staleEmail.providers[0].channels.email.enabled = false;
    expect(() => buildChangePlan(parseChannelConfig(staleEmail), snapshot(), validateEnvironment(parseChannelConfig(staleEmail), env()))).toThrow(/disabled email/i);
    const staleWhatsApp = validConfig();
    staleWhatsApp.providers[0].channels.whatsapp.enabled = false;
    expect(() => buildChangePlan(parseChannelConfig(staleWhatsApp), snapshot(), validateEnvironment(parseChannelConfig(staleWhatsApp), env()))).toThrow(/disabled WhatsApp/i);
  });
});

describe("channel change planning", () => {
  it("inserts new contacts, preserves unspecified contacts, and builds complete settings", () => {
    const existing = { id: "00000000-0000-0000-0000-000000000099", contact_type: "other", name: "Untouched", role_title: null, email: "other@example.com", phone_e164: null, whatsapp_opt_in_at: null, whatsapp_opt_in_source: null, active: true };
    const config = parseChannelConfig(validConfig());
    const plan = buildChangePlan(config, snapshot({ providers: [{ ...snapshot().providers[0], contacts: [existing] }] }), validateEnvironment(config, env()));
    expect(plan.providers[0].contactOperations).toHaveLength(1);
    expect(plan.providers[0].contactOperations[0].kind).toBe("insert");
    expect(plan.providers[0].settings.email_to).toEqual([{ key: "noc-primary", id: null }]);
    expect(JSON.stringify(plan)).not.toContain("other@example.com");
  });

  it("matches by explicit id before email and rejects conflicting identities", () => {
    const configRaw = validConfig();
    const existing = {
      id: "00000000-0000-0000-0000-000000000020", contact_type: "recipient", name: "Old", role_title: null,
      email: "noc@example.com", phone_e164: "+8801712345678", whatsapp_opt_in_at: "2026-08-10T00:00:00.000Z",
      whatsapp_opt_in_source: "written-consent", active: true,
    };
    configRaw.providers[0].contacts[0].id = existing.id;
    const config = parseChannelConfig(configRaw);
    const plan = buildChangePlan(config, snapshot({ providers: [{ ...snapshot().providers[0], contacts: [existing] }] }), validateEnvironment(config, env()));
    expect(plan.providers[0].contactOperations[0]).toMatchObject({ kind: "update", id: existing.id });

    const conflict = structuredClone(existing);
    conflict.id = "00000000-0000-0000-0000-000000000021";
    conflict.email = "different@example.com";
    expect(() => buildChangePlan(config, snapshot({ providers: [{ ...snapshot().providers[0], contacts: [existing, conflict] }] }), validateEnvironment(config, env()))).not.toThrow();
    configRaw.providers[0].contacts[0].id = null;
    configRaw.providers[0].contacts[0].email = existing.email;
    configRaw.providers[0].contacts[0].phoneE164 = conflict.phone_e164;
    expect(() => buildChangePlan(parseChannelConfig(configRaw), snapshot({ providers: [{ ...snapshot().providers[0], contacts: [existing, conflict] }] }), validateEnvironment(parseChannelConfig(configRaw), env()))).toThrow(/different existing contacts|ambiguous/i);
  });

  it("produces a redacted preview", () => {
    const configRaw = validConfig();
    configRaw.providers[0].channels.email.bcc = ["noc-primary"];
    configRaw.providers[0].channels.discord = {
      enabled: true,
      target: { source: "provider", webhookUrl: "https://discord.com/api/webhooks/1/private-value" },
      mentionIds: ["123", "123"],
    };
    const config = parseChannelConfig(configRaw);
    const context = validateEnvironment(config, env());
    const output = formatRedactedPreview(buildChangePlan(config, snapshot(), context));
    expect(output).toContain("n***@example.com");
    expect(output).toContain("+88***78");
    expect(output).toContain("BCC: 1");
    expect(output).toContain("Discord: configured");
    expect(output).not.toContain("noc@example.com");
    expect(output).not.toContain("private-value");
    expect(output).not.toContain(rawKey);
  });

  it("detects semantic route changes even when contacts are unchanged", () => {
    const configRaw = validConfig();
    const existing = {
      id: "00000000-0000-0000-0000-000000000020", contact_type: "recipient", name: "NOC Primary",
      role_title: "Operations", email: "noc@example.com", phone_e164: "+8801712345678",
      whatsapp_opt_in_at: "2026-08-10T00:00:00.000Z", whatsapp_opt_in_source: "written-consent", active: true,
    };
    configRaw.providers[0].contacts[0].id = existing.id;
    const currentSettings = {
      email_enabled: true, whatsapp_enabled: true, discord_enabled: false,
      email_to: [existing.id], email_cc: [], email_bcc: [], reply_to: null,
      subject_prefix: "[Old]", email_template_override: null,
      whatsapp_template_name: "expiry_notice", whatsapp_recipient_ids: [existing.id],
      discord_webhook_ciphertext: null, discord_mention_ids: [],
    };
    const config = parseChannelConfig(configRaw);
    const plan = buildChangePlan(config, snapshot({ providers: [{ ...snapshot().providers[0], contacts: [existing], settings: currentSettings }] }), validateEnvironment(config, env()));
    expect(plan.providers[0].contactOperations).toHaveLength(0);
    expect(plan.providers[0].settingsChanged).toBe(true);
    const output = formatRedactedPreview(plan);
    expect(output).toContain("n***@example.com");
    expect(output).toContain("+88***78");
  });

  it("treats an identical desired state as a no-op", () => {
    const configRaw = validConfig();
    const existing = {
      id: "00000000-0000-0000-0000-000000000020", contact_type: "recipient", name: "NOC Primary",
      role_title: "Operations", email: "noc@example.com", phone_e164: "+8801712345678",
      whatsapp_opt_in_at: "2026-08-10T00:00:00.000Z", whatsapp_opt_in_source: "written-consent", active: true,
    };
    configRaw.providers[0].contacts[0].id = existing.id;
    const currentSettings = {
      email_enabled: true, whatsapp_enabled: true, discord_enabled: false,
      email_to: [existing.id], email_cc: [], email_bcc: [], reply_to: null,
      subject_prefix: "[Expiry]", email_template_override: null,
      whatsapp_template_name: "expiry_notice", whatsapp_recipient_ids: [existing.id],
      discord_webhook_ciphertext: null, discord_mention_ids: [],
    };
    const parsed = parseChannelConfig(configRaw);
    const plan = buildChangePlan(parsed, snapshot({ providers: [{ ...snapshot().providers[0], contacts: [existing], settings: currentSettings }] }), validateEnvironment(parsed, env()));
    expect(plan.providers[0].settingsChanged).toBe(false);
    expect(plan.providers[0].discordState).toBe("disabled");
  });

  it("sanitizes secret-shaped errors", () => {
    const passwordUrl = "postgresql://user:private-password@host/db";
    expect(sanitizeError(new Error(`failed ${passwordUrl}`), [passwordUrl, "private-password"])).toBe("failed [REDACTED]");
  });
});
