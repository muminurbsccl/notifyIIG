import "server-only";
import { buildMilestones, getDhakaBusinessDate, subtractCalendarDays } from "@/lib/domain/date-rules";
import { buildIdempotencyKey, buildTargetHash } from "@/lib/domain/idempotency";
import { classifyDeliveryError } from "@/lib/domain/retry";
import { buildExpiryEmail } from "@/lib/domain/notification-email";
import { dispatchChannel } from "@/lib/integrations/index";
import { getServerConfig } from "@/lib/server-config";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { decryptTarget, encryptTarget, maskTarget } from "./target-crypto";
import { buildEmailTargets } from "./recipients";

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

type RpcChain = {
  then<TResult1 = { data: unknown; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
};

type EngineClient = {
  from(table: string): Chain;
  rpc(functionName: string, args?: Record<string, unknown>): RpcChain;
};

type ResolvedRecipient = {
  channel: "email" | "whatsapp" | "discord";
  target: string;
  mentionIds?: string[];
};

type DeliveryClaim = {
  id: string;
  event_id: string;
  channel: string;
  target_hash: string;
  target_ciphertext: string;
  status: string;
  attempts: number;
  next_attempt_at?: string | null;
  idempotency_key?: string;
};

type ResolvedEventContext = {
  externalCircuitId: string;
  expiryDate: string;
  milestoneLabel: string;
};

const CIRCUIT_PAGE_SIZE = 200;
const CLAIM_BATCH = 100;
const TERMINAL_DELIVERY_STATUSES = ["sent", "delivered", "permanent_failure", "suppressed"];
const ELIGIBLE_CIRCUIT_STATUSES = ["active", "renewal_pending", "renewed"];
const DEFAULT_RULE_CODE = "global-default";
// Keep expired circuits eligible for this many days so a missed cron run still
// delivers the expiry-day (T-0) notice exactly once, via event idempotency.
const EXPIRY_GRACE_DAYS = 7;

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

function asUuidList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.floor(value);
}

function safeStatus(value: unknown): string {
  return typeof value === "string" ? value : "";
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
  const contacts = requireData(contactsResult, "provider contacts").map((contact) => {
    const contactType = typeof contact.contact_type === "string" ? contact.contact_type : undefined;
    return {
      active: contact.active === true,
      type: contactType,
      contact_type: contactType,
      email: typeof contact.email === "string" ? contact.email : undefined,
      id: typeof contact.id === "string" ? contact.id : undefined,
      phone_e164: typeof contact.phone_e164 === "string" ? contact.phone_e164 : undefined,
      whatsapp_opt_in_at: contact.whatsapp_opt_in_at,
    };
  });

  const emailEnabled = asBoolean(settings.email_enabled, true);
  const whatsappEnabled = asBoolean(settings.whatsapp_enabled, false);
  const discordEnabled = asBoolean(settings.discord_enabled, false);

  const recipients: ResolvedRecipient[] = [];

  const emailTargets = buildEmailTargets(
    {
      emailEnabled,
      explicitTo: normalizeRecipientList(settings.email_to),
    },
    contacts,
  );
  for (const target of emailTargets) {
    recipients.push({ channel: "email", target });
  }

  if (whatsappEnabled) {
    const waIds = new Set(
      normalizeStringArray(settings.whatsapp_recipient_ids).map((value) => value.toLowerCase()),
    );
    const candidates =
      waIds.size > 0
        ? contacts.filter((contact) => waIds.has(String(contact.id).toLowerCase()))
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

  if (discordEnabled) {
    let webhook: string | null = null;
    if (typeof settings.discord_webhook_ciphertext === "string" && config.appEncryptionKey) {
      try {
        webhook = decryptTarget(settings.discord_webhook_ciphertext, config.appEncryptionKey);
      } catch {
        webhook = null;
      }
    }
    webhook ??= config.discordWebhookUrl;
    if (webhook) {
      const mentionIds = normalizeStringArray(settings.discord_mention_ids);
      recipients.push({ channel: "discord", target: webhook, mentionIds });
    }
  }

  return recipients;
}

function normalizeRecipientList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return trimmed.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  }
}

function normalizeStringArray(value: unknown): string[] {
  return normalizeRecipientList(value).filter((entry): entry is string => typeof entry === "string");
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

async function resolveEventContext(
  client: EngineClient,
  eventId: string,
  contextCache: Map<string, ResolvedEventContext>,
): Promise<ResolvedEventContext | null> {
  const cached = contextCache.get(eventId);
  if (cached) return cached;

  const eventResult = await client
    .from("notification_events")
    .select("circuit_id,milestone_key")
    .eq("id", eventId)
    .maybeSingle();
  if (eventResult.error) {
    throw new Error(`Failed to load notification event: ${eventResult.error.message}`);
  }
  const event = requireSingleRow(eventResult, "notification event");
  if (!event) return null;

  const circuitResult = await client
    .from("circuits")
    .select("id,external_circuit_id,expiry_date")
    .eq("id", String(event.circuit_id))
    .maybeSingle();
  if (circuitResult.error) {
    throw new Error(`Failed to load circuit: ${circuitResult.error.message}`);
  }
  const circuit = requireSingleRow(circuitResult, "circuit");
  if (!circuit) return null;

  const context = {
    externalCircuitId: asString(circuit.external_circuit_id),
    expiryDate: asString(circuit.expiry_date),
    milestoneLabel: asString(event.milestone_key),
  };

  contextCache.set(eventId, context);
  return context;
}

function buildDispatchInput(
  context: {
    channel: string;
    target: string;
    externalCircuitId: string;
    expiryDate: string;
    milestoneLabel: string;
    mentionIds?: string[];
  },
  config: ReturnType<typeof getServerConfig>,
) {
  if (context.channel === "email") {
    const email = buildExpiryEmail({
      circuitId: context.externalCircuitId,
      expiryDate: context.expiryDate,
      milestoneLabel: context.milestoneLabel,
    });
    return {
      channel: "email" as const,
      to: [context.target],
      ...email,
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

function asDeliveryClaims(result: unknown): DeliveryClaim[] {
  const rows = Array.isArray(result) ? result : [];
  return rows.map((row) => {
    const item = row as Row;
    return {
      id: asString(item.id),
      event_id: asString(item.event_id),
      channel: asString(item.channel),
      target_hash: asString(item.target_hash),
      target_ciphertext: asString(item.target_ciphertext),
      status: safeStatus(item.status),
      attempts: asNumber(item.attempts),
      next_attempt_at:
        item.next_attempt_at === null || typeof item.next_attempt_at === "undefined"
          ? null
          : asString(item.next_attempt_at),
      idempotency_key: typeof item.idempotency_key === "string" ? item.idempotency_key : undefined,
    };
  });
}

function normalizeRpcError(error: { message: string } | null, context: string): never {
  if (error === null) {
    throw new Error(`Failed to ${context}`);
  }
  throw new Error(`Failed to ${context}: ${error.message}`);
}

function eventCompletionStatus(statuses: string[]): string {
  const hasFailure = statuses.some(
    (status) => status === "permanent_failure" || status === "suppressed",
  );
  const hasSuccess = statuses.some((status) => status === "sent" || status === "delivered");
  if (hasFailure && hasSuccess) return "partial_failure";
  if (hasFailure) return "failed";
  return "completed";
}

function isTerminalDeliveryStatus(status: string): boolean {
  return TERMINAL_DELIVERY_STATUSES.includes(status);
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
  const eventContextCache = new Map<string, ResolvedEventContext>();
  const affectedEventIds = new Set<string>();

  // Phase A: eligible circuits in bounded pages.
  let page = 0;
  for (;;) {
    const circuitsResult = await client
      .from("circuits")
      .select(
        "id,provider_id,external_circuit_id,expiry_date,expiry_version,notification_enabled,notification_rule_id,renewal_procedure_start_date,status",
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
      const graceCutoff = subtractCalendarDays(businessDate, EXPIRY_GRACE_DAYS);
      if (!expiryDate || expiryDate < graceCutoff) continue;
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
      const firstMilestoneDueDate = asString(circuit.renewal_procedure_start_date);
      const dueMilestones = buildMilestones(
        expiryDate,
        milestoneDefinitions,
        firstMilestoneDueDate ? { firstMilestoneDueDate } : {},
      ).filter(
        (milestone) => milestone.dueDate <= businessDate,
      );
      if (dueMilestones.length === 0) continue;

      const expiryVersion = typeof circuit.expiry_version === "number" ? circuit.expiry_version : 1;

      const ensureResult = await client.rpc("ensure_due_notification_events", {
        p_circuit_id: String(circuit.id),
        p_expiry_version: expiryVersion,
        p_rule_id: rule.id,
        p_milestones: dueMilestones.map((milestone) => ({
          key: milestone.key,
          label: milestone.label,
          dueDate: milestone.dueDate,
        })),
      });
      if (ensureResult.error) {
        normalizeRpcError(ensureResult.error, "ensure due notification events");
      }
      const eventIds = asUuidList(ensureResult.data);
      counts.eventsUpserted += eventIds.length;

      if (eventIds.length === 0) continue;

      const recipients = await resolveRecipients(client, String(circuit.provider_id), config);
      if (recipients.length === 0) {
        continue;
      }

      // Phase B: independent queued deliveries for new events.
      for (const eventId of eventIds) {
        for (const recipient of recipients) {
          const encryptedTarget = encryptTarget(recipient.target, config.appEncryptionKey);
          const deliveryUpsert = await client
            .from("notification_deliveries")
            .upsert(
              {
                event_id: eventId,
                channel: recipient.channel,
                target_hash: buildTargetHash(recipient.channel, recipient.target),
                masked_target: maskTarget(recipient.channel, recipient.target),
                target_ciphertext: encryptedTarget,
                idempotency_key: buildIdempotencyKey(eventId, recipient.channel, recipient.target),
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
          counts.deliveriesCreated += requireData(deliveryUpsert, "delivery upsert").length;
        }
      }
    }

    if (circuits.length < CIRCUIT_PAGE_SIZE) break;
    page += 1;
  }

  // Phase C: claim and dispatch due deliveries.
  for (;;) {
    const claimResult = await client.rpc("claim_notification_deliveries", { p_limit: CLAIM_BATCH });
    if (claimResult.error) {
      normalizeRpcError(claimResult.error, "claim queued deliveries");
    }
    const claimed = asDeliveryClaims(claimResult.data);
    if (claimed.length === 0) break;

    for (const delivery of claimed) {
      counts.deliveriesClaimed += 1;
      const deliveryId = String(delivery.id);

      const eventContext = await resolveEventContext(client, String(delivery.event_id), eventContextCache);
      if (!eventContext) {
        await client
          .from("notification_deliveries")
          .update({
            status: "permanent_failure",
            attempts: delivery.attempts,
            last_error_code: "unresolvable_target",
            last_error_message: "Recipient target no longer resolvable",
          })
          .eq("id", deliveryId);
        counts.permanentFailures += 1;
        continue;
      }

      let target = "";
      try {
        target = decryptTarget(delivery.target_ciphertext, config.appEncryptionKey);
      } catch {
        await client
          .from("notification_deliveries")
          .update({
            status: "permanent_failure",
            attempts: delivery.attempts,
            last_error_code: "invalid_target_ciphertext",
            last_error_message: "Unable to decrypt notification target",
          })
          .eq("id", deliveryId);
        counts.permanentFailures += 1;
        continue;
      }

      const result = await dispatchChannel(
        buildDispatchInput(
          {
            ...eventContext,
            channel: delivery.channel,
            target,
          },
          config,
        ),
      );

      if (result.ok) {
        await client
          .from("notification_deliveries")
          .update({
            status: "sent",
            attempts: delivery.attempts,
            external_message_id: result.externalId,
            sent_at: now.toISOString(),
            last_error_code: null,
            last_error_message: null,
          })
          .eq("id", deliveryId);
        counts.sent += 1;
      } else {
        const classification = classifyDeliveryError(result.status, result.message, delivery.attempts);
        if (!classification.retryable) {
          await client
            .from("notification_deliveries")
            .update({
              status: "permanent_failure",
              attempts: delivery.attempts,
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
              attempts: delivery.attempts,
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
    if (statuses.every(isTerminalDeliveryStatus)) {
      await client
        .from("notification_events")
        .update({ status: eventCompletionStatus(statuses), completed_at: now.toISOString() })
        .eq("id", eventId);
    }
  }

  return { ok: true, businessDate, counts };
}
