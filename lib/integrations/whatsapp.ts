import "server-only";
import { getServerConfig } from "@/lib/server-config";
import { classifyDeliveryError } from "@/lib/domain/retry";
import type { ChannelResult, WhatsAppSendInput } from "./types";
import { safeResponseText } from "./email";

export async function sendWhatsApp(input: WhatsAppSendInput): Promise<ChannelResult> {
  const config = getServerConfig();
  if (!config.whatsappAccessToken || !config.whatsappPhoneNumberId) {
    return {
      ok: false,
      kind: "permanent",
      status: null,
      message: "WhatsApp channel is not configured",
    };
  }
  const templateName = input.templateName || config.whatsappTemplateName;
  if (!templateName) {
    return {
      ok: false,
      kind: "permanent",
      status: null,
      message: "WhatsApp template is not configured",
    };
  }
  try {
    const response = await fetch(
      `https://graph.facebook.com/${config.whatsappApiVersion}/${config.whatsappPhoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.whatsappAccessToken}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: input.to,
          type: "template",
          template: {
            name: templateName,
            language: { code: "en" },
            components: [
              {
                type: "body",
                parameters: input.variables.map((value) => ({ type: "text", text: value })),
              },
            ],
          },
        }),
      },
    );
    if (!response.ok) {
      const message = await safeResponseText(response);
      const classification = classifyDeliveryError(response.status, message);
      return { ok: false, kind: classification.kind, status: response.status, message };
    }
    let externalId: string | null = null;
    try {
      const body = (await response.json()) as { messages?: Array<{ id?: string }> };
      externalId = body.messages?.[0]?.id ?? null;
    } catch {
      // Non-JSON success bodies carry no external id.
    }
    return { ok: true, externalId };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "WhatsApp channel request failed";
    const classification = classifyDeliveryError(null, message);
    return { ok: false, kind: classification.kind, status: null, message };
  }
}
