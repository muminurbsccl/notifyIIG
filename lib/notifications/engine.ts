import "server-only";
import { buildMilestones, getDhakaBusinessDate } from "@/lib/domain/date-rules";
import { buildIdempotencyKey, buildTargetHash } from "@/lib/domain/idempotency";
import { classifyDeliveryError } from "@/lib/domain/retry";
import { escapeHtml } from "@/lib/domain/templates";
import { dispatchChannel } from "@/lib/integrations/index";
import { getServerConfig } from "@/lib/server-config";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { decryptTarget, encryptTarget, maskTarget } from "./target-crypto";

export type JobCounts = {
  circuitsProcessed: number;
  eventsUpserted: number;
  deliveriesCreated: number;
  deliveriesClaimed: number;
  sent: number;
  retryScheduled: number;
  permanentFailures: number;
};

export type JobSummary = {
  ok: true;
  businessDate: string;
  counts: JobCounts;
};

type Row = Record<string, unknown>;
// Query results carry an array for list queries and a single row (or null) for
// maybeSingle/single queries; helpers below normalize both shapes.
type QueryResult = { data: Row | Row[] | null; error: { message: string } | null };

type Chain = {
  select(fields: string): Chain;
  eq(column: string, value: unknown): Chain;
  in(column: string, values: unknown[]): Chain;
  lte(column: string, value: unknown): Chain;
  order(column: string, options?: { ascending?: boolean }): Chain;
  range(start: number, end: number): Chain;
  limit(value: number): Chain;
  maybeSingle(): Chain;
  single(): Chain;
  upsert(
    rows: Row | Row[],
    options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): Chain;
  update(values: Row): Chain;
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
};

type EngineClient = { from(table: string): Chain };

type ResolvedRecipient = {
  channel: "email" | "whatsapp" | "discord";
  target: string;
  mentionIds?: string[];
};

type DispatchContext = ResolvedRecipient & {
  externalCircuitId: string;
  expiryDate: string;
  milestoneLabel: string;
};

const CIRCUIT_PAGE_SIZE = 200;
const CLAIM_BATCH = 100;
const TERMINAL_DELIVERY_STATUSES = ["sent", "delivered", "permanent_failure", "suppressed"];
const ELIGIBLE_CIRCUIT_STATUSES = ["active", "renewal_pending", "renewed"];
const DEFAULT_RULE_CODE = "global-default";

function requireData(result: QueryResult, context: string): Row[] {
  if (result.error) throw new Error(`Failed to load ${context}: ${result.error.message}`);
  if (Array.isArray(result.data)) return result.data;
  return result.data ? [result.data] : [];
}

function requireSingleRow(result: QueryResult, context: string): Row | null {
  if (result.error) throw new Error(`Failed to load ${context}: ${result.error.message}`);
  if (Array.isArray(result.data)) return result.data[0] ?? null;
  return result.data;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

async function resolveRecipients(
  client: EngineClient,
  providerId: string,
  config: ReturnType<typeof getServerConfig>,
): Promise<ResolvedRecipient[]> {
  const settingsResult = await client
    .from("provider_notification_settings")
    .select(
      "email_enabled,whatsapp_enabled,discord_enabled,email_to,email_cc,email_bcc,whatsapp_recipient_ids,discord_mention_ids,discord_webhook_ciphertext",
    )
    .eq("provider_id", providerId)
    .maybeSingle();
  if (settingsResult.error) {
    throw new Error(`Failed to load notification settings: ${settingsResult.error.message}`);
  }
  const settings: Row = requireSingleRow(settingsResult, "notification settings") ?? {};

  const contactsResult = await client
    .from("provider_contacts")
    .select("id,contact_type,name,email,phone_e164,whatsapp_opt_in_at,active")
    .eq("provider_id", providerId)
    .eq("active", true);
  if (contactsResult.error) {
    throw new Error(`Failed to load provider contacts: ${contactsResult.error.message}`);
  }
  const contacts = requireData(contactsResult, "provider contacts");

  const recipients: ResolvedRecipient[] = [];

  if (settings.email_enabled !== false) {
    const emailList = Array.isArray(settings.email_to) ? (settings.email_to as unknown[]) : [];
    const candidates =
      emailList.length > 0
        ? contacts.filter(
            (contact) => emailList.includes(contact.id) || emailList.includes(contact.email),
          )
        : contacts.filter(
            (contact) => contact.contact_type === "recipient" && typeof contact.email === "string",
          );
    for (const contact of candidates) {
      if (typeof contact.email === "string" && contact.email.trim() !== "") {
        recipients.push({ channel: "email", target: contact.email });
      }
    }
  }

  if (settings.whatsapp_enabled === true) {
    const waIds = Array.isArray(settings.whatsapp_recipient_ids)
      ? (settings.whatsapp_recipient_ids as unknown[])
      : [];
    const candidates =
      waIds.length > 0
        ? contacts.filter((contact) => waIds.includes(contact.id))
        : contacts.filter((contact) => contact.contact_type === "recipient");
    for (const contact of candidates) {
      if (
        typeof contact.phone_e164 === "string" &&
        contact.whatsapp_opt_in_at !== null &&
        contact.whatsapp_opt_in_at !== undefined
      ) {
        recipients.push({ channel: "whatsapp", target: contact.phone_e164 });
      }
    }
  }

  if (settings.discord_enabled === true) {
    let webhook = config.discordWebhookUrl;
    if (!webhook && typeof settings.discord_webhook_ciphertext === "string" && config.appEncryptionKey) {
      try {
        webhook = decryptTarget(settings.discord_webhook_ciphertext, config.appEncryptionKey);
      } catch {
        webhook = null;
      }
    }
    if (webhook) {
      const mentionIds = Array.isArray(settings.discord_mention_ids)
        ? (settings.discord_mention_ids as unknown[])
        : [];
      recipients.push({ channel: "discord", target: webhook, mentionIds: mentionIds as string[] });
    }
  }

  return recipients;
}

async function resolveDeliveryContext(
  client: EngineClient,
  delivery: Row,
  targetCache: Map<string, DispatchContext>,
): Promise<DispatchContext | null> {
  const cached = targetCache.get(String(delivery.id));
  if (cached) return cached;

  const eventResult = await client
    .from("notification_events")
    .select("circuit_id,milestone_key")
    .eq("id", String(delivery.event_id))
    .maybeSingle();
  if (eventResult.error) {
    throw new Error(`Failed to load notification event: ${eventResult.error.message}`);
  }
  const event = requireSingleRow(eventResult, "notification event");
  if (!event) return null;

  const circuitResult = await client
    .from("circuits")
    .select("id,provider_id,external_circuit_id,expiry_date")
    .eq("id", String(event.circuit_id))
    .maybeSingle();
  if (circuitResult.error) {
    throw new Error(`Failed to load circuit: ${circuitResult.error.message}`);
  }
  const circuit = requireSingleRow(circuitResult, "circuit");
  if (!circuit) return null;

  const config = getServerConfig();
  const recipients = await resolveRecipients(client, String(circuit.provider_id), config);
  const targetHash = String(delivery.target_hash);
  const channel = String(delivery.channel);
  const match = recipients.find(
    (recipient) =>
      recipient.channel === channel &&
      buildTargetHash(recipient.channel, recipient.target) === targetHash,
  );
  if (!match) return null;

  return {
    ...match,
    externalCircuitId: asString(circuit.external_circuit_id),
    expiryDate: asString(circuit.expiry_date),
    milestoneLabel: asString(event.milestone_key),
  };
}

function buildDispatchInput(context: DispatchContext, config: ReturnType<typeof getServerConfig>) {
  if (context.channel === "email") {
    return {
      channel: "email" as const,
      to: [context.target],
      subject: `Circuit ${context.externalCircuitId} expires ${context.expiryDate}`,
      bodyHtml: `<p>Circuit <b>${escapeHtml(context.externalCircuitId)}</b> expires on ${context.expiryDate}.</p><p>${escapeHtml(context.milestoneLabel)}</p>`,
      bodyText: `Circuit ${context.externalCircuitId} expires on ${context.expiryDate}. ${context.milestoneLabel}`,
    };
  }
  if (context.channel === "whatsapp") {
    return {
      channel: "whatsapp" as const,
      to: context.target,
      templateName: config.whatsappTemplateName ?? "",
      variables: [context.externalCircuitId, context.expiryDate, context.milestoneLabel],
    };
  }
  return {
    channel: "discord" as const,
    webhookUrl: context.target,
    title: `Circuit ${context.externalCircuitId} expires ${context.expiryDate}`,
    description: context.milestoneLabel,
    mentionIds: context.mentionIds ?? [],
  };
}

export async function runExpiryNotificationJob(
  now: Date = new Date(),
  serviceClient: EngineClient = createServiceSupabaseClient() as unknown as EngineClient,
): Promise<JobSummary> {
  const config = getServerConfig();
  if (!config.appEncryptionKey) {
    throw new Error("APP_ENCRYPTION_KEY is required");
  }
  const client = serviceClient;
  const businessDate = getDhakaBusinessDate(now);
  const counts: JobCounts = {
    circuitsProcessed: 0,
    eventsUpserted: 0,
    deliveriesCreated: 0,
    deliveriesClaimed: 0,
    sent: 0,
    retryScheduled: 0,
    permanentFailures: 0,
  };
  const targetCache = new Map<string, DispatchContext>();
  const affectedEventIds = new Set<string>();

  // Phase A: eligible circuits in bounded pages.
  let page = 0;
  for (;;) {
    const circuitsResult = await client
      .from("circuits")
      .select(
        "id,provider_id,external_circuit_id,expiry_date,expiry_version,notification_enabled,notification_rule_id,status",
      )
      .eq("notification_enabled", true)
      .in("status", ELIGIBLE_CIRCUIT_STATUSES)
      .range(page * CIRCUIT_PAGE_SIZE, page * CIRCUIT_PAGE_SIZE + CIRCUIT_PAGE_SIZE - 1)
      .order("id");
    if (circuitsResult.error) {
      throw new Error(`Failed to load circuits: ${circuitsResult.error.message}`);
    }
    const circuits = requireData(circuitsResult, "circuits");
    if (circuits.length === 0) break;

    for (const circuit of circuits) {
      const expiryDate = asString(circuit.expiry_date);
      if (!expiryDate || expiryDate < businessDate) continue;
      counts.circuitsProcessed += 1;

      let ruleQuery = client.from("notification_rules").select("id,code,active");
      ruleQuery =
        typeof circuit.notification_rule_id === "string"
          ? ruleQuery.eq("id", circuit.notification_rule_id)
          : ruleQuery.eq("code", DEFAULT_RULE_CODE);
      const ruleResult = await ruleQuery.maybeSingle();
      if (ruleResult.error) {
        throw new Error(`Failed to load notification rule: ${ruleResult.error.message}`);
      }
      const rule = requireSingleRow(ruleResult, "notification rule");
      if (!rule || rule.active !== true) continue;

      const milestonesResult = await client
        .from("notification_milestones")
        .select("milestone_key,label,months_before,days_before,enabled")
        .eq("rule_id", rule.id);
      if (milestonesResult.error) {
        throw new Error(`Failed to load milestones: ${milestonesResult.error.message}`);
      }
      const milestoneDefinitions = requireData(milestonesResult, "milestones").map((row) => ({
        key: asString(row.milestone_key),
        label: asString(row.label),
        monthsBefore: typeof row.months_before === "number" ? row.months_before : undefined,
        daysBefore: typeof row.days_before === "number" ? row.days_before : undefined,
        enabled: row.enabled !== false,
      }));
      const dueMilestones = buildMilestones(expiryDate, milestoneDefinitions).filter(
        (milestone) => milestone.dueDate <= businessDate,
      );

      const externalCircuitId = asString(circuit.external_circuit_id, "circuit");
      const expiryVersion = typeof circuit.expiry_version === "number" ? circuit.expiry_version : 1;

      for (const milestone of dueMilestones) {
        const eventUpsert = await client
          .from("notification_events")
          .upsert(
            {
              circuit_id: circuit.id,
              expiry_version: expiryVersion,
              rule_id: rule.id,
              milestone_key: milestone.key,
              due_date: milestone.dueDate,
              status: "pending",
              generated_at: now.toISOString(),
            },
            { onConflict: "circuit_id,expiry_version,milestone_key", ignoreDuplicates: true },
          )
          .select("id");
        if (eventUpsert.error) {
          throw new Error(`Failed to upsert notification event: ${eventUpsert.error.message}`);
        }
        const insertedEvents = requireData(eventUpsert, "notification event upsert");
        if (insertedEvents.length === 0) continue;
        counts.eventsUpserted += 1;
        const eventId = String(insertedEvents[0].id);

        // Phase B: independent queued deliveries for this new event.
        const recipients = await resolveRecipients(client, String(circuit.provider_id), config);
        for (const recipient of recipients) {
          const deliveryUpsert = await client
            .from("notification_deliveries")
            .upsert(
              {
                event_id: eventId,
                channel: recipient.channel,
                target_hash: buildTargetHash(recipient.channel, recipient.target),
                masked_target: maskTarget(recipient.channel, recipient.target),
                target_ciphertext: encryptTarget(recipient.target, config.appEncryptionKey),
                idempotency_key: buildIdempotencyKey(
                  eventId,
                  recipient.channel,
                  recipient.target,
                ),
                status: "queued",
                attempts: 0,
                next_attempt_at: null,
              },
              { onConflict: "idempotency_key", ignoreDuplicates: true },
            )
            .select("id");
          if (deliveryUpsert.error) {
            throw new Error(`Failed to upsert notification delivery: ${deliveryUpsert.error.message}`);
          }
          for (const row of requireData(deliveryUpsert, "delivery upsert")) {
            counts.deliveriesCreated += 1;
            targetCache.set(String(row.id), {
              ...recipient,
              externalCircuitId,
              expiryDate,
              milestoneLabel: milestone.label,
            });
          }
        }
      }
    }

    if (circuits.length < CIRCUIT_PAGE_SIZE) break;
    page += 1;
  }

  // Phase C: claim and dispatch due deliveries.
  const deliveryFields =
    "id,event_id,channel,target_hash,idempotency_key,status,attempts,next_attempt_at";
  const queuedResult = await client
    .from("notification_deliveries")
    .select(deliveryFields)
    .eq("status", "queued")
    .limit(CLAIM_BATCH);
  if (queuedResult.error) {
    throw new Error(`Failed to claim queued deliveries: ${queuedResult.error.message}`);
  }
  const retryResult = await client
    .from("notification_deliveries")
    .select(deliveryFields)
    .eq("status", "retry_scheduled")
    .lte("next_attempt_at", now.toISOString())
    .limit(CLAIM_BATCH);
  if (retryResult.error) {
    throw new Error(`Failed to claim retry deliveries: ${retryResult.error.message}`);
  }

  const claimed = [
    ...requireData(queuedResult, "queued deliveries"),
    ...requireData(retryResult, "retry deliveries"),
  ];

  for (const delivery of claimed) {
    counts.deliveriesClaimed += 1;
    const deliveryId = String(delivery.id);
    const context = await resolveDeliveryContext(client, delivery, targetCache);
    if (!context) {
      await client
        .from("notification_deliveries")
        .update({
          status: "permanent_failure",
          attempts: (typeof delivery.attempts === "number" ? delivery.attempts : 0) + 1,
          last_error_code: "unresolvable_target",
          last_error_message: "Recipient target no longer resolvable",
        })
        .eq("id", deliveryId);
      counts.permanentFailures += 1;
      continue;
    }

    const result = await dispatchChannel(buildDispatchInput(context, config));
    const nextAttempts = (typeof delivery.attempts === "number" ? delivery.attempts : 0) + 1;

    if (result.ok) {
      await client
        .from("notification_deliveries")
        .update({
          status: "sent",
          attempts: nextAttempts,
          external_message_id: result.externalId,
          sent_at: now.toISOString(),
          last_error_code: null,
          last_error_message: null,
        })
        .eq("id", deliveryId);
      counts.sent += 1;
    } else {
      const classification = classifyDeliveryError(result.status, result.message, nextAttempts);
      if (classification.kind === "permanent") {
        await client
          .from("notification_deliveries")
          .update({
            status: "permanent_failure",
            attempts: nextAttempts,
            last_error_code: result.status === null ? "channel_failure" : String(result.status),
            last_error_message: result.message.slice(0, 500),
          })
          .eq("id", deliveryId);
        counts.permanentFailures += 1;
      } else {
        const nextAt = new Date(now.getTime() + classification.delaySeconds * 1000).toISOString();
        await client
          .from("notification_deliveries")
          .update({
            status: "retry_scheduled",
            attempts: nextAttempts,
            next_attempt_at: nextAt,
            last_error_code: result.status === null ? "network" : String(result.status),
            last_error_message: result.message.slice(0, 500),
          })
          .eq("id", deliveryId);
        counts.retryScheduled += 1;
      }
    }
    affectedEventIds.add(String(delivery.event_id));
  }

  // Complete events whose deliveries are all terminal.
  for (const eventId of affectedEventIds) {
    const statusResult = await client
      .from("notification_deliveries")
      .select("status")
      .eq("event_id", eventId);
    if (statusResult.error) {
      throw new Error(`Failed to inspect event deliveries: ${statusResult.error.message}`);
    }
    const statuses = requireData(statusResult, "delivery statuses").map((row) => asString(row.status));
    if (statuses.every((status) => TERMINAL_DELIVERY_STATUSES.includes(status))) {
      await client
        .from("notification_events")
        .update({ status: "completed", completed_at: now.toISOString() })
        .eq("id", eventId);
    }
  }

  return { ok: true, businessDate, counts };
}
