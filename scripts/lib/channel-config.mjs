import { z } from "zod";
import {
  decryptTargetCore,
  maskTargetCore,
  parseEncryptionKey,
} from "../../lib/notifications/target-crypto-core.mjs";

const uuid = z.string().uuid();
const contactKey = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const nullableText = z.string().trim().min(1).nullable();

const optInSchema = z.object({
  at: z.string().datetime({ offset: true }),
  source: z.string().trim().min(1),
}).strict();

const contactSchema = z.object({
  key: contactKey,
  id: uuid.nullable(),
  contactType: z.enum(["internal_owner", "provider_account_manager", "recipient", "other"]),
  name: z.string().trim().min(1),
  roleTitle: nullableText,
  email: z.string().trim().email().nullable(),
  phoneE164: z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/).nullable(),
  whatsappOptIn: optInSchema.nullable(),
  active: z.boolean(),
}).strict();

const emailSchema = z.object({
  enabled: z.boolean(),
  to: z.array(contactKey),
  cc: z.array(contactKey),
  bcc: z.array(contactKey),
  replyTo: z.string().trim().email().nullable(),
  subjectPrefix: nullableText,
  templateOverride: nullableText,
}).strict();

const whatsappSchema = z.object({
  enabled: z.boolean(),
  recipients: z.array(contactKey),
  templateName: nullableText,
}).strict();

const discordTargetSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("global") }).strict(),
  z.object({ source: z.literal("provider"), webhookUrl: z.string().url().refine((value) => value.startsWith("https://"), "Discord webhook must use HTTPS") }).strict(),
]);

const discordSchema = z.object({
  enabled: z.boolean(),
  target: discordTargetSchema.nullable(),
  mentionIds: z.array(z.string().regex(/^\d+$/)),
}).strict();

const providerSchema = z.object({
  code: z.string().trim().min(2).max(40).transform((value) => value.toUpperCase()),
  contacts: z.array(contactSchema),
  channels: z.object({ email: emailSchema, whatsapp: whatsappSchema, discord: discordSchema }).strict(),
}).strict();

const configSchema = z.object({
  version: z.literal(1),
  projectRef: z.string().regex(/^[a-z0-9]{8,64}$/),
  actorEmail: z.string().trim().email().transform((value) => value.toLowerCase()),
  providers: z.array(providerSchema).min(1),
}).strict();

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}`);
    seen.add(value);
  }
}

function unique(values) {
  return [...new Set(values)];
}

export function parseChannelConfig(raw) {
  const parsed = configSchema.parse(raw);
  assertUnique(parsed.providers.map((provider) => provider.code), "provider code");
  for (const provider of parsed.providers) {
    assertUnique(provider.contacts.map((contact) => contact.key), `contact key for ${provider.code}`);
    for (const contact of provider.contacts) {
      if (contact.email) contact.email = contact.email.toLowerCase();
      if (contact.whatsappOptIn) contact.whatsappOptIn.at = new Date(contact.whatsappOptIn.at).toISOString();
    }
    assertUnique(provider.contacts.map((contact) => contact.email).filter(Boolean), `email identity for ${provider.code}`);
    assertUnique(provider.contacts.map((contact) => contact.phoneE164).filter(Boolean), `phone identity for ${provider.code}`);
    provider.channels.discord.mentionIds = unique(provider.channels.discord.mentionIds);
  }
  return parsed;
}

function projectRefFromUrl(value) {
  if (!value) return null;
  try {
    const host = new URL(value).hostname;
    return host.endsWith(".supabase.co") ? host.slice(0, -".supabase.co".length) : null;
  } catch {
    return null;
  }
}

function projectRefFromDatabase(value) {
  if (!value) return null;
  try {
    const username = decodeURIComponent(new URL(value).username);
    return username.startsWith("postgres.") ? username.slice("postgres.".length) : null;
  } catch {
    return null;
  }
}

export function validateEnvironment(config, environment) {
  if (!environment.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const publicRef = projectRefFromUrl(environment.NEXT_PUBLIC_SUPABASE_URL);
  const databaseRef = projectRefFromDatabase(environment.DATABASE_URL);
  if (publicRef && publicRef !== config.projectRef) throw new Error("projectRef does not match NEXT_PUBLIC_SUPABASE_URL");
  if (databaseRef && databaseRef !== config.projectRef) throw new Error("projectRef does not match DATABASE_URL tenant");

  const providerDiscord = config.providers.some((provider) => provider.channels.discord.enabled && provider.channels.discord.target?.source === "provider");
  const globalDiscord = config.providers.some((provider) => provider.channels.discord.enabled && provider.channels.discord.target?.source === "global");
  if (providerDiscord) parseEncryptionKey(environment.APP_ENCRYPTION_KEY ?? "");
  if (globalDiscord && !environment.DISCORD_WEBHOOK_URL) throw new Error("DISCORD_WEBHOOK_URL is required for global Discord routing");
  return {
    projectRef: config.projectRef,
    databaseUrl: environment.DATABASE_URL ?? null,
    appEncryptionKey: environment.APP_ENCRYPTION_KEY ?? null,
    globalDiscordWebhookUrl: environment.DISCORD_WEBHOOK_URL ?? null,
    sensitiveValues: [environment.DATABASE_URL, environment.APP_ENCRYPTION_KEY, environment.DISCORD_WEBHOOK_URL].filter(Boolean),
  };
}

function normalizedExisting(contact) {
  return {
    id: contact.id,
    contact_type: contact.contact_type,
    name: contact.name,
    role_title: contact.role_title ?? null,
    email: contact.email?.trim().toLowerCase() ?? null,
    phone_e164: contact.phone_e164?.trim() ?? null,
    whatsapp_opt_in_at: contact.whatsapp_opt_in_at ? new Date(contact.whatsapp_opt_in_at).toISOString() : null,
    whatsapp_opt_in_source: contact.whatsapp_opt_in_source ?? null,
    active: contact.active,
  };
}

function desiredContact(contact) {
  return {
    contact_type: contact.contactType,
    name: contact.name,
    role_title: contact.roleTitle,
    email: contact.email,
    phone_e164: contact.phoneE164,
    whatsapp_opt_in_at: contact.whatsappOptIn?.at ?? null,
    whatsapp_opt_in_source: contact.whatsappOptIn?.source ?? null,
    active: contact.active,
  };
}

function findMatch(contact, existing, providerCode) {
  if (contact.id) {
    const match = existing.find((item) => item.id === contact.id);
    if (!match) throw new Error(`${providerCode}/${contact.key}: contact id does not belong to provider`);
    return match;
  }
  const emailMatches = contact.email ? existing.filter((item) => item.email === contact.email) : [];
  const phoneMatches = contact.phoneE164 ? existing.filter((item) => item.phone_e164 === contact.phoneE164) : [];
  if (emailMatches.length > 1 || phoneMatches.length > 1) throw new Error(`${providerCode}/${contact.key}: ambiguous existing contact identity`);
  if (emailMatches[0] && phoneMatches[0] && emailMatches[0].id !== phoneMatches[0].id) {
    throw new Error(`${providerCode}/${contact.key}: email and phone identify different existing contacts`);
  }
  return emailMatches[0] ?? phoneMatches[0] ?? null;
}

function sameObject(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function validateRoutes(provider, contactsByKey) {
  const { email, whatsapp, discord } = provider.channels;
  if (email.enabled && email.to.length === 0) throw new Error(`${provider.code}: enabled email requires at least one to recipient`);
  if (!email.enabled && (email.to.length || email.cc.length || email.bcc.length)) {
    throw new Error(`${provider.code}: disabled email must have empty recipient routes`);
  }
  for (const [bucket, keys] of [["to", email.to], ["cc", email.cc], ["bcc", email.bcc]]) {
    for (const key of keys) {
      const contact = contactsByKey.get(key);
      if (!contact?.active || !contact.email) throw new Error(`${provider.code}/${key}: ${bucket} recipient requires an active email contact`);
    }
  }
  for (const key of whatsapp.recipients) {
    const contact = contactsByKey.get(key);
    if (!contact?.active || !contact.phoneE164 || !contact.whatsappOptIn?.at || !contact.whatsappOptIn?.source) {
      throw new Error(`${provider.code}/${key}: WhatsApp recipient requires active E.164 phone and opt-in evidence`);
    }
  }
  if (whatsapp.enabled && whatsapp.recipients.length === 0) throw new Error(`${provider.code}: enabled WhatsApp requires recipients`);
  if (!whatsapp.enabled && whatsapp.recipients.length) {
    throw new Error(`${provider.code}: disabled WhatsApp must have empty recipient routes`);
  }
  if (discord.enabled && !discord.target) throw new Error(`${provider.code}: enabled Discord requires a target`);
  if (!discord.enabled && discord.target) throw new Error(`${provider.code}: disabled Discord cannot define a target`);
}

function existingSettingsComparable(settings, context) {
  if (!settings) return null;
  let discordIdentity = null;
  if (settings.discord_webhook_ciphertext && context.appEncryptionKey) {
    try { discordIdentity = decryptTargetCore(settings.discord_webhook_ciphertext, context.appEncryptionKey); } catch { discordIdentity = "[UNREADABLE]"; }
  }
  if (settings.discord_enabled && !settings.discord_webhook_ciphertext && context.globalDiscordWebhookUrl) {
    discordIdentity = context.globalDiscordWebhookUrl;
  }
  return { ...settings, discord_webhook_ciphertext: undefined, discordIdentity };
}

function desiredSettings(provider, keyToId, context) {
  const { email, whatsapp, discord } = provider.channels;
  const target = discord.enabled ? discord.target : null;
  return {
    email_enabled: email.enabled,
    whatsapp_enabled: whatsapp.enabled,
    discord_enabled: discord.enabled,
    email_to: email.to.map((key) => ({ key, id: keyToId.get(key) ?? null })),
    email_cc: email.cc.map((key) => ({ key, id: keyToId.get(key) ?? null })),
    email_bcc: email.bcc.map((key) => ({ key, id: keyToId.get(key) ?? null })),
    reply_to: email.replyTo,
    subject_prefix: email.subjectPrefix,
    email_template_override: email.templateOverride,
    whatsapp_template_name: whatsapp.templateName,
    whatsapp_recipient_ids: whatsapp.recipients.map((key) => ({ key, id: keyToId.get(key) ?? null })),
    discord_webhook_ciphertext: null,
    discord_mention_ids: discord.mentionIds,
    discordSource: target?.source ?? null,
    discordIdentity: target?.source === "provider" ? target.webhookUrl : target?.source === "global" ? context.globalDiscordWebhookUrl : null,
  };
}

export function buildChangePlan(config, snapshot, context) {
  if (!snapshot.actor || snapshot.actor.active !== true || snapshot.actor.role !== "admin") {
    throw new Error("actorEmail must resolve to one active admin profile");
  }
  const plans = [];
  for (const provider of config.providers) {
    const matches = snapshot.providers.filter((item) => item.code.toUpperCase() === provider.code);
    if (matches.length !== 1) throw new Error(`${provider.code}: provider must resolve exactly once`);
    const current = matches[0];
    const contactsByKey = new Map(provider.contacts.map((contact) => [contact.key, contact]));
    validateRoutes(provider, contactsByKey);
    const existing = current.contacts.map(normalizedExisting);
    const contactOperations = [];
    const keyToId = new Map();
    for (const contact of provider.contacts) {
      const match = findMatch(contact, existing, provider.code);
      const desired = desiredContact(contact);
      if (!match) contactOperations.push({ kind: "insert", key: contact.key, values: desired });
      else {
        keyToId.set(contact.key, match.id);
        const { id: _id, ...before } = match;
        if (!sameObject(before, desired)) contactOperations.push({ kind: "update", key: contact.key, id: match.id, before, values: desired });
      }
    }
    const settings = desiredSettings(provider, keyToId, context);
    const comparableCurrent = existingSettingsComparable(current.settings, context);
    const desiredResolved = {
      email_enabled: settings.email_enabled,
      whatsapp_enabled: settings.whatsapp_enabled,
      discord_enabled: settings.discord_enabled,
      email_to: settings.email_to.map((entry) => entry.id),
      email_cc: settings.email_cc.map((entry) => entry.id),
      email_bcc: settings.email_bcc.map((entry) => entry.id),
      reply_to: settings.reply_to,
      subject_prefix: settings.subject_prefix,
      email_template_override: settings.email_template_override,
      whatsapp_template_name: settings.whatsapp_template_name,
      whatsapp_recipient_ids: settings.whatsapp_recipient_ids.map((entry) => entry.id),
      discord_mention_ids: settings.discord_mention_ids,
      discordIdentity: settings.discordIdentity,
    };
    const currentResolved = comparableCurrent && {
      email_enabled: comparableCurrent.email_enabled,
      whatsapp_enabled: comparableCurrent.whatsapp_enabled,
      discord_enabled: comparableCurrent.discord_enabled,
      email_to: comparableCurrent.email_to ?? [],
      email_cc: comparableCurrent.email_cc ?? [],
      email_bcc: comparableCurrent.email_bcc ?? [],
      reply_to: comparableCurrent.reply_to ?? null,
      subject_prefix: comparableCurrent.subject_prefix ?? null,
      email_template_override: comparableCurrent.email_template_override ?? null,
      whatsapp_template_name: comparableCurrent.whatsapp_template_name ?? null,
      whatsapp_recipient_ids: comparableCurrent.whatsapp_recipient_ids ?? [],
      discord_mention_ids: comparableCurrent.discord_mention_ids ?? [],
      discordIdentity: comparableCurrent.discordIdentity,
    };
    const settingsChanged = contactOperations.length > 0 || !sameObject(currentResolved, desiredResolved);
    const currentDiscordEnabled = comparableCurrent?.discord_enabled === true;
    const desiredDiscordEnabled = settings.discord_enabled === true;
    const discordState = !desiredDiscordEnabled
      ? currentDiscordEnabled ? "removed" : "disabled"
      : !currentDiscordEnabled ? "configured"
      : comparableCurrent.discordIdentity === settings.discordIdentity ? "configured" : "changed";
    const emailKeys = unique([...provider.channels.email.to, ...provider.channels.email.cc]);
    const providerPlan = {
      providerId: current.id,
      code: provider.code,
      contactOperations,
      settings,
      settingsChanged,
      discordState,
      beforeSummary: {
        channels: {
          email: comparableCurrent?.email_enabled ?? false,
          whatsapp: comparableCurrent?.whatsapp_enabled ?? false,
          discord: comparableCurrent?.discord_enabled ?? false,
        },
        recipients: {
          emailTo: comparableCurrent?.email_to?.length ?? 0,
          emailCc: comparableCurrent?.email_cc?.length ?? 0,
          emailBcc: comparableCurrent?.email_bcc?.length ?? 0,
          whatsapp: comparableCurrent?.whatsapp_recipient_ids?.length ?? 0,
        },
        discordConfigured: currentDiscordEnabled,
      },
      previewRecipients: {
        email: emailKeys.map((key) => maskTargetCore("email", contactsByKey.get(key).email)),
        whatsapp: provider.channels.whatsapp.recipients.map((key) => maskTargetCore("whatsapp", contactsByKey.get(key).phoneE164)),
      },
    };
    if (provider.channels.discord.target?.source === "provider") {
      Object.defineProperty(providerPlan, "discordPlaintext", { value: provider.channels.discord.target.webhookUrl, enumerable: false });
    }
    plans.push(providerPlan);
  }
  return { actor: snapshot.actor, projectRef: config.projectRef, providers: plans };
}

export function getProviderDiscordPlaintext(providerPlan) {
  return providerPlan.discordPlaintext ?? null;
}

export function formatRedactedPreview(plan) {
  const lines = [`Project: ${plan.projectRef}`];
  for (const provider of [...plan.providers].sort((a, b) => a.code.localeCompare(b.code))) {
    lines.push(`${provider.code}: contacts insert=${provider.contactOperations.filter((op) => op.kind === "insert").length} update=${provider.contactOperations.filter((op) => op.kind === "update").length}`);
    for (const operation of provider.contactOperations) {
      if (operation.values.email) lines.push(`  ${operation.key} email ${maskTargetCore("email", operation.values.email)}`);
      if (operation.values.phone_e164) lines.push(`  ${operation.key} WhatsApp ${maskTargetCore("whatsapp", operation.values.phone_e164)}`);
    }
    for (const masked of provider.previewRecipients.email) lines.push(`  route email ${masked}`);
    for (const masked of provider.previewRecipients.whatsapp) lines.push(`  route WhatsApp ${masked}`);
    lines.push(`  Email: ${provider.settings.email_enabled ? "enabled" : "disabled"}; To: ${provider.settings.email_to.length}; CC: ${provider.settings.email_cc.length}; BCC: ${provider.settings.email_bcc.length}`);
    lines.push(`  WhatsApp: ${provider.settings.whatsapp_enabled ? "enabled" : "disabled"}; recipients: ${provider.settings.whatsapp_recipient_ids.length}`);
    lines.push(`  Discord: ${provider.discordState}`);
  }
  return lines.join("\n");
}

export function sanitizeError(error, sensitiveValues = []) {
  let message = error instanceof Error ? error.message : String(error);
  for (const value of [...sensitiveValues].filter(Boolean).sort((a, b) => b.length - a.length)) {
    message = message.split(value).join("[REDACTED]");
  }
  message = message.replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1[REDACTED]@");
  return message;
}
