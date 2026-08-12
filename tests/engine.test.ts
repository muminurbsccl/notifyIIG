import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runExpiryNotificationJob } from "@/lib/notifications/engine";
import { makeFakeClient, type Row } from "./helpers/fake-supabase-client";

vi.mock("server-only", () => ({}));

describe("notification engine", () => {
  const now = new Date("2026-09-01T03:00:00.000Z");
  const circuitId = "00000000-0000-0000-0000-0000000000a1";
  const providerId = "00000000-0000-0000-0000-0000000000b1";
  const ruleId = "00000000-0000-0000-0000-0000000000c1";
  const eventId = "00000000-0000-0000-0000-0000000000d1";

  function baseState(): Record<string, Row[]> {
    return {
      circuits: [
        {
          id: circuitId,
          provider_id: providerId,
          external_circuit_id: "USID-1",
          expiry_date: "2026-12-31",
          expiry_version: 1,
          notification_enabled: true,
          notification_rule_id: null,
          status: "active",
        },
      ],
      providers: [{ id: providerId, name: "Example Provider" }],
      notification_rules: [{ id: ruleId, code: "global-default", first_lead_months: 4, active: true }],
      notification_milestones: [
        { rule_id: ruleId, milestone_key: "T-4M", label: "Initial reminder", months_before: 4, days_before: null, enabled: true },
        { rule_id: ruleId, milestone_key: "T-30D", label: "Thirty-day reminder", months_before: null, days_before: 30, enabled: true },
      ],
      provider_notification_settings: [],
      provider_contacts: [
        { id: "00000000-0000-0000-0000-0000000000e1", provider_id: providerId, contact_type: "recipient", name: "Ops", email: "ops@bscplc.test", phone_e164: null, whatsapp_opt_in_at: null, active: true },
      ],
      notification_events: [],
      notification_deliveries: [],
    };
  }

  beforeEach(() => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("EMAIL_API_URL", "https://email.example.test/v1/send");
    vi.stubEnv("EMAIL_API_KEY", "email-key-test");
    vi.stubEnv("EMAIL_FROM", "notify@bscplc.test");
    vi.stubEnv("EMAIL_FROM_NAME", "BSCPLC");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates due events and idempotent deliveries, claims and dispatches them", async () => {
    const { client, tables } = makeFakeClient(baseState());
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messageId: "email-1" }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    try {
      const summary = await runExpiryNotificationJob(now, client as never);

      expect(summary.ok).toBe(true);
      expect(summary.businessDate).toBe("2026-09-01");
      expect(summary.counts).toMatchObject({
        circuitsProcessed: 1,
        eventsUpserted: 1,
        deliveriesCreated: 1,
        deliveriesClaimed: 1,
        sent: 1,
        retryScheduled: 0,
        permanentFailures: 0,
      });

      const events = tables.notification_events;
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ circuit_id: circuitId, expiry_version: 1, milestone_key: "T-4M", due_date: "2026-08-31" });

      const deliveries = tables.notification_deliveries;
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({
        channel: "email",
        status: "sent",
        attempts: 1,
        external_message_id: "email-1",
        masked_target: "o***@bscplc.test",
      });
      expect(deliveries[0].target_hash).toHaveLength(64);
      expect(deliveries[0].target_ciphertext).toBeTruthy();
      expect(tables.notification_events[0].status).toBe("completed");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("creates nothing new when the same run repeats", async () => {
    const { client, tables } = makeFakeClient(baseState());
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messageId: "email-1" }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    try {
      await runExpiryNotificationJob(now, client as never);
      const first = JSON.parse(JSON.stringify(tables));
      const summary = await runExpiryNotificationJob(now, client as never);

      expect(summary.counts.eventsUpserted).toBe(0);
      expect(summary.counts.deliveriesCreated).toBe(0);
      expect(summary.counts.deliveriesClaimed).toBe(0);
      expect(JSON.parse(JSON.stringify(tables))).toEqual(first);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("schedules retries for transient failures and keeps the event open", async () => {
    const { client, tables } = makeFakeClient(baseState());
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "rate limited" }), { status: 429, headers: { "content-type": "application/json" } }),
    );
    try {
      const summary = await runExpiryNotificationJob(now, client as never);

      expect(summary.counts.retryScheduled).toBe(1);
      expect(summary.counts.sent).toBe(0);
      const delivery = tables.notification_deliveries[0];
      expect(delivery.status).toBe("retry_scheduled");
      expect(delivery.attempts).toBe(1);
      expect(String(delivery.next_attempt_at) > now.toISOString()).toBe(true);
      expect(tables.notification_events[0].status).toBe("pending");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not claim future retry attempts", async () => {
    const state = baseState();
    state.notification_events = [
      { id: eventId, circuit_id: circuitId, expiry_version: 1, milestone_key: "T-4M", due_date: "2026-08-31", status: "pending" },
    ];
    state.notification_deliveries = [
      {
        id: "00000000-0000-0000-0000-0000000000f1",
        event_id: eventId,
        channel: "email",
        target_hash: "ab".repeat(32),
        masked_target: "o***@bscplc.test",
        idempotency_key: "key-1",
        status: "retry_scheduled",
        attempts: 1,
        next_attempt_at: "2026-09-02T03:00:00.000Z",
      },
    ];
    const { client } = makeFakeClient(state);
    const summary = await runExpiryNotificationJob(now, client as never);
    expect(summary.counts.deliveriesClaimed).toBe(0);
  });

  it("honors disabled channels and whatsapp opt-in requirements", async () => {
    const state = baseState();
    state.provider_notification_settings = [
      {
        provider_id: providerId,
        email_enabled: false,
        whatsapp_enabled: true,
        discord_enabled: false,
        email_to: "[]",
        email_cc: "[]",
        email_bcc: "[]",
        whatsapp_recipient_ids: [],
        discord_mention_ids: "[]",
      },
    ];
    state.provider_contacts = [
      {
        id: "00000000-0000-0000-0000-0000000000e1",
        provider_id: providerId,
        contact_type: "recipient",
        name: "Ops",
        email: "ops@bscplc.test",
        phone_e164: "+8801712345678",
        whatsapp_opt_in_at: null,
        active: true,
      },
    ];
    const { client, tables } = makeFakeClient(state);
    const summary = await runExpiryNotificationJob(now, client as never);

    expect(summary.counts.deliveriesCreated).toBe(0);
    expect(tables.notification_deliveries).toHaveLength(0);
  });
});
