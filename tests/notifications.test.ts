import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiProfile: vi.fn(),
  runExpiryNotificationJob: vi.fn(),
  dispatchChannel: vi.fn(),
  writeAudit: vi.fn(),
  serviceClient: vi.fn(),
}));

class TestAuthError extends Error {
  status: 401 | 403 | 503;
  constructor(status: 401 | 403 | 503, message: string) {
    super(message);
    this.status = status;
  }
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireApiProfile: mocks.requireApiProfile, AuthError: TestAuthError }));
vi.mock("@/lib/notifications/engine", () => ({ runExpiryNotificationJob: mocks.runExpiryNotificationJob }));
vi.mock("@/lib/integrations/index", () => ({ dispatchChannel: mocks.dispatchChannel }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabaseClient: () => mocks.serviceClient(),
}));

const { GET: cronHandler } = await import("@/app/api/cron/expiry-notifications/route");
const { POST: resendHandler } = await import("@/app/api/notifications/[id]/resend/route");
const { POST: channelTestHandler } = await import("@/app/api/channels/test/route");

const actorId = "00000000-0000-0000-0000-000000000001";

// ---------------------------------------------------------------------------
// Cron route
// ---------------------------------------------------------------------------

describe("cron route authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "cron-secret-test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 401 without a bearer secret", async () => {
    const response = await cronHandler(new Request("http://localhost/api/cron/expiry-notifications"));
    expect(response.status).toBe(401);
    expect(mocks.runExpiryNotificationJob).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong secret", async () => {
    const response = await cronHandler(
      new Request("http://localhost/api/cron/expiry-notifications", {
        headers: { authorization: "Bearer wrong-secret" },
      }),
    );
    expect(response.status).toBe(401);
    expect(mocks.runExpiryNotificationJob).not.toHaveBeenCalled();
  });

  it("runs the job with the correct secret and returns counts only", async () => {
    mocks.runExpiryNotificationJob.mockResolvedValue({
      ok: true,
      businessDate: "2026-09-01",
      counts: { circuitsProcessed: 1, eventsUpserted: 1, deliveriesCreated: 1, deliveriesClaimed: 1, sent: 1, retryScheduled: 0, permanentFailures: 0 },
    });

    const response = await cronHandler(
      new Request("http://localhost/api/cron/expiry-notifications", {
        headers: { authorization: "Bearer cron-secret-test" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      businessDate: "2026-09-01",
      counts: { circuitsProcessed: 1, eventsUpserted: 1, deliveriesCreated: 1, deliveriesClaimed: 1, sent: 1, retryScheduled: 0, permanentFailures: 0 },
    });
    expect(mocks.runExpiryNotificationJob).toHaveBeenCalledOnce();
  });

  it("redacts job failures into a safe 500", async () => {
    mocks.runExpiryNotificationJob.mockRejectedValue(new Error("secret service key leaked"));
    const response = await cronHandler(
      new Request("http://localhost/api/cron/expiry-notifications", {
        headers: { authorization: "Bearer cron-secret-test" },
      }),
    );
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("service key");
    expect(body.error.code).toBe("CRON_JOB_FAILED");
  });
});

// ---------------------------------------------------------------------------
// Resend route
// ---------------------------------------------------------------------------

describe("notification resend route", () => {
  const deliveryId = "00000000-0000-0000-0000-0000000000f1";
  const existingDelivery = {
    id: deliveryId,
    event_id: "00000000-0000-0000-0000-0000000000d1",
    channel: "email",
    target_hash: "ab".repeat(32),
    masked_target: "o***@bscplc.test",
    target_ciphertext: "placeholder",
    status: "sent",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("APP_ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef");
    mocks.requireApiProfile.mockResolvedValue({
      user: { id: actorId },
      profile: { role: "admin" },
      supabase: { rpc: vi.fn() },
    });
    mocks.serviceClient = vi.fn().mockReturnValue({
      from: (table: string) => {
        const data = table === "notification_deliveries" ? [existingDelivery] : [];
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.maybeSingle = () => ({
          then: (resolve: (value: { data: typeof data[number] | null; error: null }) => void) =>
            resolve({ data: data[0] ?? null, error: null }),
        });
        chain.upsert = (row: Record<string, unknown>) => ({
          select: () => ({
            then: (resolve: (value: { data: Record<string, unknown>[]; error: null }) => void) =>
              resolve({ data: [{ ...row, id: "00000000-0000-0000-0000-0000000000f2" }], error: null }),
          }),
        });
        return chain;
      },
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires an administrator or operations editor", async () => {
    mocks.requireApiProfile.mockRejectedValue(new TestAuthError(403, "Forbidden"));
    const response = await resendHandler(
      new Request("http://localhost/api/notifications/1/resend", {
        method: "POST",
        body: JSON.stringify({ reason: "please resend" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: deliveryId }) },
    );
    expect(response.status).toBe(403);
  });

  it("requires a non-empty reason", async () => {
    const response = await resendHandler(
      new Request("http://localhost/api/notifications/1/resend", {
        method: "POST",
        body: JSON.stringify({ reason: "  " }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: deliveryId }) },
    );
    expect(response.status).toBe(400);
  });

  it("creates a distinct queued delivery with a resend-suffixed key and audits it", async () => {
    const response = await resendHandler(
      new Request("http://localhost/api/notifications/1/resend", {
        method: "POST",
        body: JSON.stringify({ reason: "operator follow-up" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: deliveryId }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.deliveryId).toBeTruthy();
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: actorId, action: "notification.resend", entityType: "notification_delivery" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Channel test route
// ---------------------------------------------------------------------------

describe("channel test route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiProfile.mockResolvedValue({
      user: { id: actorId },
      profile: { role: "admin" },
      supabase: { rpc: vi.fn() },
    });
    mocks.dispatchChannel.mockResolvedValue({ ok: true, externalId: "test-1" });
  });

  it("requires an administrator", async () => {
    mocks.requireApiProfile.mockRejectedValue(new TestAuthError(403, "Forbidden"));
    const response = await channelTestHandler(
      new Request("http://localhost/api/channels/test", {
        method: "POST",
        body: JSON.stringify({ channel: "email", target: "ops@bscplc.test" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.dispatchChannel).not.toHaveBeenCalled();
  });

  it("dispatches to the separately supplied target only", async () => {
    const response = await channelTestHandler(
      new Request("http://localhost/api/channels/test", {
        method: "POST",
        body: JSON.stringify({ channel: "email", target: "ops@bscplc.test", subject: "Test", bodyText: "Hello" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.dispatchChannel).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "email", to: ["ops@bscplc.test"] }),
    );
  });

  it("refuses whatsapp tests without opt-in metadata", async () => {
    const response = await channelTestHandler(
      new Request("http://localhost/api/channels/test", {
        method: "POST",
        body: JSON.stringify({ channel: "whatsapp", target: "+8801712345678" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.dispatchChannel).not.toHaveBeenCalled();
  });

  it("allows whatsapp tests with opt-in metadata", async () => {
    const response = await channelTestHandler(
      new Request("http://localhost/api/channels/test", {
        method: "POST",
        body: JSON.stringify({ channel: "whatsapp", target: "+8801712345678", optedIn: true, optInSource: "operator test" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.dispatchChannel).toHaveBeenCalledWith(expect.objectContaining({ channel: "whatsapp" }));
  });

  it("never echoes secrets in failure responses", async () => {
    mocks.dispatchChannel.mockResolvedValue({ ok: false, kind: "permanent", status: 400, message: "webhook https://discord.com/api/webhooks/111/secret failed" });
    const response = await channelTestHandler(
      new Request("http://localhost/api/channels/test", {
        method: "POST",
        body: JSON.stringify({ channel: "discord", target: "https://discord.com/api/webhooks/111/secret" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("webhooks/111/secret");
  });
});
