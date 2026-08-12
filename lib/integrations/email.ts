import "server-only";
import { getServerConfig } from "@/lib/server-config";
import { classifyDeliveryError } from "@/lib/domain/retry";
import type { ChannelResult, EmailSendInput } from "./types";

const MAX_ERROR_TEXT = 200;

export async function safeResponseText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, MAX_ERROR_TEXT);
  } catch {
    return `Channel responded with status ${response.status}`;
  }
}

export async function sendEmail(input: EmailSendInput): Promise<ChannelResult> {
  const config = getServerConfig();
  if (!config.emailApiUrl || !config.emailApiKey || !config.emailFrom) {
    return { ok: false, kind: "permanent", status: null, message: "Email channel is not configured" };
  }
  try {
    const response = await fetch(config.emailApiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.emailApiKey}`,
      },
      body: JSON.stringify({
        from: { name: config.emailFromName ?? "BSCPLC", email: config.emailFrom },
        to: input.to.map((email) => ({ email })),
        cc: (input.cc ?? []).map((email) => ({ email })),
        bcc: (input.bcc ?? []).map((email) => ({ email })),
        replyTo: input.replyTo ?? null,
        subject: input.subject,
        html: input.bodyHtml,
        text: input.bodyText,
      }),
    });
    if (!response.ok) {
      const message = await safeResponseText(response);
      const classification = classifyDeliveryError(response.status, message);
      return { ok: false, kind: classification.kind, status: response.status, message };
    }
    let externalId: string | null = null;
    try {
      const body = (await response.json()) as { messageId?: string };
      externalId = typeof body.messageId === "string" ? body.messageId : null;
    } catch {
      // Non-JSON success bodies carry no external id.
    }
    return { ok: true, externalId };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Email channel request failed";
    const classification = classifyDeliveryError(null, message);
    return { ok: false, kind: classification.kind, status: null, message };
  }
}
