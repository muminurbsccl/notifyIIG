import "server-only";
import { classifyDeliveryError } from "@/lib/domain/retry";
import type { ChannelResult, DiscordSendInput } from "./types";
import { safeResponseText } from "./email";

export function sanitizeDiscordMentions(text: string): string {
  return text.replace(/@everyone/gi, "everyone").replace(/@here/gi, "here");
}

export async function sendDiscord(input: DiscordSendInput): Promise<ChannelResult> {
  const webhookUrl = input.webhookUrl.trim();
  if (!webhookUrl) {
    return {
      ok: false,
      kind: "permanent",
      status: null,
      message: "Discord channel is not configured",
    };
  }
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        embeds: [{ title: input.title, description: sanitizeDiscordMentions(input.description) }],
        allowed_mentions: { parse: [], users: input.mentionIds ?? [] },
      }),
    });
    if (!response.ok) {
      const message = await safeResponseText(response);
      const classification = classifyDeliveryError(response.status, message);
      return { ok: false, kind: classification.kind, status: response.status, message };
    }
    return { ok: true, externalId: null };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Discord channel request failed";
    const classification = classifyDeliveryError(null, message);
    return { ok: false, kind: classification.kind, status: null, message };
  }
}
