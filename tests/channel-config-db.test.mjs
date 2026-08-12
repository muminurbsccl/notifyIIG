import { describe, expect, it } from "vitest";
import { applyChangePlan, runDryRun } from "../scripts/lib/channel-config-db.mjs";
import { parseChannelConfig, validateEnvironment } from "../scripts/lib/channel-config.mjs";

const config = parseChannelConfig({
  version: 1, projectRef: "exampleprojectref123", actorEmail: "admin@example.com",
  providers: [{ code: "NTT", contacts: [{ key: "noc", id: null, contactType: "recipient", name: "NOC", roleTitle: null, email: "noc@example.com", phoneE164: null, whatsappOptIn: null, active: true }], channels: {
    email: { enabled: true, to: ["noc"], cc: [], bcc: [], replyTo: null, subjectPrefix: null, templateOverride: null },
    whatsapp: { enabled: false, recipients: [], templateName: null },
    discord: { enabled: false, target: null, mentionIds: [] },
  }}],
});
const context = validateEnvironment(config, {
  NEXT_PUBLIC_SUPABASE_URL: "https://exampleprojectref123.supabase.co",
  DATABASE_URL: "postgresql://postgres.exampleprojectref123:password@pooler/db",
});

class FakeClient {
  constructor({ failOn } = {}) { this.queries = []; this.failOn = failOn; }
  async query(text, params = []) {
    this.queries.push({ text, params });
    if (this.failOn && text.includes(this.failOn)) throw new Error("database operation failed");
    if (text.includes("from public.profiles")) return { rows: [{ id: "00000000-0000-0000-0000-000000000001", email: "admin@example.com", role: "admin", active: true }] };
    if (text.includes("from public.providers")) return { rows: [{ id: "00000000-0000-0000-0000-000000000010", code: "NTT", name: "NTT" }] };
    if (text.includes("from public.provider_contacts")) return { rows: [] };
    if (text.includes("from public.provider_notification_settings")) return { rows: [] };
    if (text.includes("insert into public.provider_contacts")) return { rows: [{ id: "00000000-0000-0000-0000-000000000020" }] };
    return { rows: [] };
  }
}

describe("channel configuration database boundary", () => {
  it("runs dry-run in a read-only transaction and always rolls back", async () => {
    const client = new FakeClient();
    const plan = await runDryRun(client, config, context);
    expect(plan.providers).toHaveLength(1);
    expect(client.queries[0].text.toLowerCase()).toBe("begin transaction read only");
    expect(client.queries.at(-1).text.toLowerCase()).toBe("rollback");
    expect(client.queries.some(({ text }) => /insert|update|delete|append_audit_log/i.test(text))).toBe(false);
  });

  it("applies contacts, settings, and audit atomically", async () => {
    const client = new FakeClient();
    await applyChangePlan(client, config, context);
    const text = client.queries.map((query) => query.text.toLowerCase()).join("\n");
    expect(client.queries[0].text.toLowerCase()).toBe("begin");
    expect(text).toContain("insert into public.provider_contacts");
    expect(text).toContain("insert into public.provider_notification_settings");
    expect(text).toContain("append_audit_log");
    const audit = client.queries.find(({ text: query }) => query.includes("append_audit_log"));
    expect(audit.params[4]).not.toBeNull();
    expect(audit.params[5]).not.toContain("noc@example.com");
    expect(client.queries.at(-1).text.toLowerCase()).toBe("commit");
  });

  it("does not write settings or audit for an unchanged plan", async () => {
    const client = new FakeClient();
    client.query = async function (text, params = []) {
      this.queries.push({ text, params });
      if (text.includes("from public.profiles")) return { rows: [{ id: "00000000-0000-0000-0000-000000000001", email: "admin@example.com", role: "admin", active: true }] };
      if (text.includes("from public.providers")) return { rows: [{ id: "00000000-0000-0000-0000-000000000010", code: "NTT", name: "NTT" }] };
      if (text.includes("from public.provider_contacts")) return { rows: [{ id: "00000000-0000-0000-0000-000000000020", provider_id: "00000000-0000-0000-0000-000000000010", contact_type: "recipient", name: "NOC", role_title: null, email: "noc@example.com", phone_e164: null, whatsapp_opt_in_at: null, whatsapp_opt_in_source: null, active: true }] };
      if (text.includes("from public.provider_notification_settings")) return { rows: [{ provider_id: "00000000-0000-0000-0000-000000000010", email_enabled: true, whatsapp_enabled: false, discord_enabled: false, email_to: ["00000000-0000-0000-0000-000000000020"], email_cc: [], email_bcc: [], reply_to: null, subject_prefix: null, email_template_override: null, whatsapp_template_name: null, whatsapp_recipient_ids: [], discord_webhook_ciphertext: null, discord_mention_ids: [] }] };
      return { rows: [] };
    };
    await applyChangePlan(client, config, context);
    const text = client.queries.map(({ text: query }) => query).join("\n");
    expect(text).not.toContain("insert into public.provider_notification_settings");
    expect(text).not.toContain("append_audit_log");
  });

  it("rolls back every provider when a settings operation fails", async () => {
    const client = new FakeClient({ failOn: "insert into public.provider_notification_settings" });
    await expect(applyChangePlan(client, config, context)).rejects.toThrow("database operation failed");
    expect(client.queries.at(-1).text.toLowerCase()).toBe("rollback");
    expect(client.queries.some(({ text }) => text.toLowerCase() === "commit")).toBe(false);
  });
});
