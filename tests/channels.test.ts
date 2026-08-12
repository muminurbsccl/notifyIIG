import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  serverConfig: {
    emailApiUrl: "https://email.example.test/v1/send",
    emailApiKey: "email-key-test",
    emailFrom: "notify@bscplc.test",
    emailFromName: "BSCPLC",
    whatsappApiVersion: "v22.0",
    whatsappAccessToken: "wa-token-test",
    whatsappPhoneNumberId: "1122334455",
    whatsappTemplateName: "circuit_expiry_reminder",
    discordWebhookUrl: "https://discord.com/api/webhooks/111/secret",
    appEncryptionKey: "0123456789abcdef0123456789abcdef",
  } as Record<string, unknown>,
}));

const baseServerConfig = { ...mocks.serverConfig };

vi.mock("@/lib/server-config", () => ({
  getServerConfig: () => ({ ...mocks.serverConfig }),
}));

vi.mock("server-only", () => ({}));

const { sendEmail } = await import("@/lib/integrations/email");
const { sendWhatsApp } = await import("@/lib/integrations/whatsapp");
const { sendDiscord, sanitizeDiscordMentions } = await import("@/lib/integrations/discord");
const { dispatchChannel } = await import("@/lib/integrations/index");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  // Restore any configuration mutated by prior tests and drop stale fetch
  // implementations (including unconsumed mockResolvedValueOnce queues).
  mocks.serverConfig = { ...baseServerConfig };
  mocks.fetch.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("email adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetch.mockResolvedValue(jsonResponse({ messageId: "email-1" }));
  });

  it("sends an HTML and plain-text payload with the API key", async () => {
    const result = await sendEmail({
      channel: "email",
      to: ["ops@bscplc.test"],
      cc: [],
      bcc: [],
      replyTo: "circuits@bscplc.test",
      subject: "Circuit USID-1 expires 2026-12-31",
      bodyHtml: "<p>Circuit <b>USID-1</b> expires.</p>",
      bodyText: "Circuit USID-1 expires.",
    });

    expect(result).toEqual({ ok: true, externalId: "email-1" });
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://email.example.test/v1/send",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer email-key-test" }),
        body: expect.stringContaining('"subject":"Circuit USID-1 expires 2026-12-31"'),
      }),
    );
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body.from).toEqual({ name: "BSCPLC", email: "notify@bscplc.test" });
    expect(body.to).toEqual([{ email: "ops@bscplc.test" }]);
    expect(body.cc).toEqual([]);
    expect(body.bcc).toEqual([]);
    expect(body.replyTo).toBe("circuits@bscplc.test");
    expect(body.html).toContain("<p>Circuit <b>USID-1</b> expires.</p>");
    expect(body.text).toContain("Circuit USID-1 expires.");
  });

  it("does not call the network when email configuration is missing", async () => {
    mocks.serverConfig.emailApiUrl = null;
    mocks.serverConfig.emailApiKey = null;

    const result = await sendEmail({
      channel: "email",
      to: ["ops@bscplc.test"],
      subject: "subject",
      bodyHtml: "<p>body</p>",
      bodyText: "body",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("permanent");
      expect(result.message.toLowerCase()).toContain("not configured");
    }
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("classifies transient and permanent channel failures", async () => {
    mocks.fetch.mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, 429));
    mocks.fetch.mockResolvedValueOnce(jsonResponse({ error: "bad recipient" }, 400));
    mocks.fetch.mockRejectedValueOnce(new Error("socket hang up"));

    const input = {
      channel: "email" as const,
      to: ["ops@bscplc.test"],
      subject: "s",
      bodyHtml: "<p>b</p>",
      bodyText: "b",
    };

    const rateLimited = await sendEmail(input);
    expect(rateLimited).toMatchObject({ ok: false, kind: "transient", status: 429 });

    const badRecipient = await sendEmail(input);
    expect(badRecipient).toMatchObject({ ok: false, kind: "permanent", status: 400 });

    const network = await sendEmail(input);
    expect(network).toMatchObject({ ok: false, kind: "transient", status: null });
    expect(network).not.toHaveProperty("headers");
  });
});

describe("whatsapp adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetch.mockResolvedValue(jsonResponse({ messages: [{ id: "wamid.42" }] }));
  });

  it("posts the approved template to the Graph API with an E.164 target", async () => {
    const result = await sendWhatsApp({
      channel: "whatsapp",
      to: "+8801712345678",
      templateName: "circuit_expiry_reminder",
      variables: ["BSCPLC", "USID-1", "2026-12-31"],
    });

    expect(result).toEqual({ ok: true, externalId: "wamid.42" });
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://graph.facebook.com/v22.0/1122334455/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer wa-token-test" }),
      }),
    );
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body.messaging_product).toBe("whatsapp");
    expect(body.to).toBe("+8801712345678");
    expect(body.type).toBe("template");
    expect(body.template.name).toBe("circuit_expiry_reminder");
    expect(body.template.language.code).toBe("en");
    expect(body.template.components).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", text: "BSCPLC" },
          { type: "text", text: "USID-1" },
          { type: "text", text: "2026-12-31" },
        ],
      },
    ]);
  });

  it("refuses to run when WhatsApp credentials are missing", async () => {
    mocks.serverConfig.whatsappAccessToken = null;

    const result = await sendWhatsApp({
      channel: "whatsapp",
      to: "+8801712345678",
      templateName: "circuit_expiry_reminder",
      variables: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("permanent");
      expect(result.message.toLowerCase()).toContain("not configured");
    }
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe("discord adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }));
  });

  it("posts an embed with an explicit allow list and no everyone/here mentions", async () => {
    const result = await sendDiscord({
      channel: "discord",
      webhookUrl: "https://discord.com/api/webhooks/111/secret",
      title: "Circuit expiry reminder",
      description: "Circuit @everyone expires soon; @here review required.",
      mentionIds: ["222222222222222222"],
    });

    expect(result).toEqual({ ok: true, externalId: null });
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body.embeds[0].title).toBe("Circuit expiry reminder");
    expect(body.embeds[0].description).not.toContain("@everyone");
    expect(body.embeds[0].description).not.toContain("@here");
    expect(body.allowed_mentions).toEqual({ parse: [], users: ["222222222222222222"] });
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/111/secret",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("refuses to run without a resolved webhook", async () => {
    const result = await sendDiscord({
      channel: "discord",
      webhookUrl: "",
      title: "t",
      description: "d",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("permanent");
    }
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("sanitizes everyone and here mentions in text", () => {
    expect(sanitizeDiscordMentions("ping @everyone and @here now")).toBe(
      "ping everyone and here now",
    );
  });
});

describe("channel dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetch.mockResolvedValue(jsonResponse({ messageId: "email-1" }));
  });

  it("routes each channel to its adapter", async () => {
    const email = await dispatchChannel({
      channel: "email",
      to: ["ops@bscplc.test"],
      subject: "s",
      bodyHtml: "<p>b</p>",
      bodyText: "b",
    });
    expect(email).toEqual({ ok: true, externalId: "email-1" });

    mocks.fetch.mockResolvedValue(jsonResponse({ messages: [{ id: "wamid.7" }] }));
    const whatsapp = await dispatchChannel({
      channel: "whatsapp",
      to: "+8801712345678",
      templateName: "circuit_expiry_reminder",
      variables: [],
    });
    expect(whatsapp).toEqual({ ok: true, externalId: "wamid.7" });

    mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }));
    const discord = await dispatchChannel({
      channel: "discord",
      webhookUrl: "https://discord.com/api/webhooks/111/secret",
      title: "t",
      description: "d",
    });
    expect(discord).toEqual({ ok: true, externalId: null });
  });
});
