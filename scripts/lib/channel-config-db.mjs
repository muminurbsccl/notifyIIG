import { encryptTargetCore, maskTargetCore } from "../../lib/notifications/target-crypto-core.mjs";
import {
  buildChangePlan,
  getProviderDiscordPlaintext,
  sanitizeError,
} from "./channel-config.mjs";

function placeholders(values, start = 1) {
  return values.map((_, index) => `$${start + index}`).join(",");
}

export async function loadSnapshot(client, config, { lock = false } = {}) {
  const suffix = lock ? " for update" : "";
  const actorResult = await client.query(
    `select id,email,role,active from public.profiles where lower(email)=lower($1)${suffix}`,
    [config.actorEmail],
  );
  if (actorResult.rows.length !== 1) throw new Error("actorEmail must resolve exactly once");

  const codes = config.providers.map((provider) => provider.code);
  const providerResult = await client.query(
    `select id,code,name from public.providers where upper(code) in (${placeholders(codes)})${suffix}`,
    codes,
  );
  const ids = providerResult.rows.map((provider) => provider.id);
  const contactsResult = ids.length ? await client.query(
    `select id,provider_id,contact_type,name,role_title,email,phone_e164,whatsapp_opt_in_at,whatsapp_opt_in_source,active from public.provider_contacts where provider_id in (${placeholders(ids)})${suffix}`,
    ids,
  ) : { rows: [] };
  const settingsResult = ids.length ? await client.query(
    `select provider_id,email_enabled,whatsapp_enabled,discord_enabled,email_to,email_cc,email_bcc,reply_to,subject_prefix,email_template_override,whatsapp_template_name,whatsapp_recipient_ids,discord_webhook_ciphertext,discord_mention_ids from public.provider_notification_settings where provider_id in (${placeholders(ids)})${suffix}`,
    ids,
  ) : { rows: [] };

  return {
    actor: actorResult.rows[0],
    providers: providerResult.rows.map((provider) => ({
      ...provider,
      contacts: contactsResult.rows.filter((contact) => contact.provider_id === provider.id),
      settings: settingsResult.rows.find((settings) => settings.provider_id === provider.id) ?? null,
    })),
  };
}

export async function runDryRun(client, config, context) {
  let primaryError;
  await client.query("begin transaction read only");
  try {
    return buildChangePlan(config, await loadSnapshot(client, config), context);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try { await client.query("rollback"); } catch (rollbackError) {
      if (!primaryError) throw rollbackError;
    }
  }
}

function resolveReferences(entries, idsByKey) {
  return entries.map((entry) => idsByKey.get(entry.key) ?? entry.id).filter(Boolean);
}

function auditSummary(provider) {
  return {
    channels: {
      email: provider.settings.email_enabled,
      whatsapp: provider.settings.whatsapp_enabled,
      discord: provider.settings.discord_enabled,
    },
    contacts: {
      inserted: provider.contactOperations.filter((operation) => operation.kind === "insert").length,
      updated: provider.contactOperations.filter((operation) => operation.kind === "update").length,
    },
    recipients: {
      emailTo: provider.settings.email_to.length,
      emailCc: provider.settings.email_cc.length,
      emailBcc: provider.settings.email_bcc.length,
      whatsapp: provider.settings.whatsapp_recipient_ids.length,
    },
    discordConfigured: provider.settings.discord_enabled,
  };
}

export async function applyChangePlan(client, config, context) {
  await client.query("begin");
  try {
    const plan = buildChangePlan(config, await loadSnapshot(client, config, { lock: true }), context);
    for (const provider of [...plan.providers].sort((a, b) => a.code.localeCompare(b.code))) {
      const idsByKey = new Map();
      for (const operation of provider.contactOperations) {
        const values = operation.values;
        if (operation.kind === "insert") {
          const result = await client.query(
            `insert into public.provider_contacts (provider_id,contact_type,name,role_title,email,phone_e164,whatsapp_opt_in_at,whatsapp_opt_in_source,active) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
            [provider.providerId, values.contact_type, values.name, values.role_title, values.email, values.phone_e164, values.whatsapp_opt_in_at, values.whatsapp_opt_in_source, values.active],
          );
          idsByKey.set(operation.key, result.rows[0].id);
        } else {
          await client.query(
            `update public.provider_contacts set contact_type=$1,name=$2,role_title=$3,email=$4,phone_e164=$5,whatsapp_opt_in_at=$6,whatsapp_opt_in_source=$7,active=$8,updated_at=timezone('utc',now()) where id=$9 and provider_id=$10`,
            [values.contact_type, values.name, values.role_title, values.email, values.phone_e164, values.whatsapp_opt_in_at, values.whatsapp_opt_in_source, values.active, operation.id, provider.providerId],
          );
          idsByKey.set(operation.key, operation.id);
        }
      }
      for (const entry of [...provider.settings.email_to, ...provider.settings.email_cc, ...provider.settings.email_bcc, ...provider.settings.whatsapp_recipient_ids]) {
        if (entry.id) idsByKey.set(entry.key, entry.id);
      }
      if (!provider.settingsChanged) continue;
      const discordPlaintext = getProviderDiscordPlaintext(provider);
      const discordCiphertext = discordPlaintext
        ? encryptTargetCore(discordPlaintext, context.appEncryptionKey)
        : null;
      await client.query(
        `insert into public.provider_notification_settings (provider_id,email_enabled,whatsapp_enabled,discord_enabled,email_to,email_cc,email_bcc,reply_to,subject_prefix,email_template_override,whatsapp_template_name,whatsapp_recipient_ids,discord_webhook_ciphertext,discord_mention_ids) values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12::uuid[],$13,$14::jsonb) on conflict (provider_id) do update set email_enabled=excluded.email_enabled,whatsapp_enabled=excluded.whatsapp_enabled,discord_enabled=excluded.discord_enabled,email_to=excluded.email_to,email_cc=excluded.email_cc,email_bcc=excluded.email_bcc,reply_to=excluded.reply_to,subject_prefix=excluded.subject_prefix,email_template_override=excluded.email_template_override,whatsapp_template_name=excluded.whatsapp_template_name,whatsapp_recipient_ids=excluded.whatsapp_recipient_ids,discord_webhook_ciphertext=excluded.discord_webhook_ciphertext,discord_mention_ids=excluded.discord_mention_ids,updated_at=timezone('utc',now())`,
        [provider.providerId, provider.settings.email_enabled, provider.settings.whatsapp_enabled, provider.settings.discord_enabled,
          JSON.stringify(resolveReferences(provider.settings.email_to, idsByKey)),
          JSON.stringify(resolveReferences(provider.settings.email_cc, idsByKey)),
          JSON.stringify(resolveReferences(provider.settings.email_bcc, idsByKey)),
          provider.settings.reply_to, provider.settings.subject_prefix, provider.settings.email_template_override,
          provider.settings.whatsapp_template_name, resolveReferences(provider.settings.whatsapp_recipient_ids, idsByKey),
          discordCiphertext, JSON.stringify(provider.settings.discord_mention_ids)],
      );
      const summary = auditSummary(provider);
      await client.query(
        `select public.append_audit_log($1::uuid,$2,$3,$4::uuid,$5::jsonb,$6::jsonb,$7)`,
        [plan.actor.id, "provider.channels.configure", "provider", provider.providerId, JSON.stringify(provider.beforeSummary), JSON.stringify(summary), `channel-config:${new Date().toISOString()}:${provider.code}`],
      );
    }
    await client.query("commit");
    return plan;
  } catch (error) {
    try { await client.query("rollback"); } catch { /* preserve primary failure */ }
    throw new Error(sanitizeError(error, context.sensitiveValues));
  }
}

export function maskDatabaseRecipient(channel, value) {
  return maskTargetCore(channel, value);
}
