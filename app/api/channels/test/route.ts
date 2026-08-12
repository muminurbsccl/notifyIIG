import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { redactFailureMessage } from "@/lib/domain/audit-redaction";
import { InputError, jsonError } from "@/lib/http";
import { dispatchChannel } from "@/lib/integrations/index";
import { getServerConfig } from "@/lib/server-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CHANNELS = ["email", "whatsapp", "discord"] as const;
type ChannelName = (typeof CHANNELS)[number];

export async function POST(request: Request) {
  try {
    await requireApiProfile(["admin"]);
  } catch (cause) {
    return jsonError(cause);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError(new InputError("INVALID_BODY", "Request body must be valid JSON"));
  }

  const channel = body.channel;
  if (typeof channel !== "string" || !CHANNELS.includes(channel as ChannelName)) {
    return jsonError(new InputError("INVALID_CHANNEL", "channel must be email, whatsapp or discord"));
  }
  const target = typeof body.target === "string" ? body.target.trim() : "";
  if (!target) {
    return jsonError(new InputError("TARGET_REQUIRED", "A test target is required"));
  }

  if (
    channel === "whatsapp" &&
    !(body.optedIn === true && typeof body.optInSource === "string" && body.optInSource.trim() !== "")
  ) {
    return jsonError(
      new InputError("OPT_IN_REQUIRED", "WhatsApp test sends require opt-in metadata"),
    );
  }

  const subject = typeof body.subject === "string" ? body.subject : undefined;
  const bodyText = typeof body.bodyText === "string" ? body.bodyText : undefined;
  const mentionIds = Array.isArray(body.mentionIds) ? (body.mentionIds as string[]) : [];

  const input =
    channel === "email"
      ? {
          channel: "email" as const,
          to: [target],
          subject: subject ?? "Channel test message",
          bodyHtml: typeof body.bodyHtml === "string" ? body.bodyHtml : "<p>Channel test message</p>",
          bodyText: bodyText ?? "Channel test message",
        }
      : channel === "whatsapp"
        ? {
            channel: "whatsapp" as const,
            to: target,
            templateName: typeof body.templateName === "string" ? body.templateName : "",
            variables: [],
          }
        : {
            channel: "discord" as const,
            webhookUrl: target,
            title: subject ?? "Channel test",
            description: bodyText ?? "Channel test",
            mentionIds,
          };

  const result = await dispatchChannel(input);
  if (result.ok) {
    return NextResponse.json({ ok: true, externalId: result.externalId });
  }

  const config = getServerConfig();
  const message = redactFailureMessage(result.message, [
    config.emailApiKey,
    config.whatsappAccessToken,
    config.discordWebhookUrl,
    config.serviceRoleKey,
    config.cronSecret,
    config.appEncryptionKey,
  ]);
  return NextResponse.json(
    { ok: false, error: { code: "CHANNEL_TEST_FAILED", message } },
    { status: 502 },
  );
}
