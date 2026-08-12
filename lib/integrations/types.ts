export type EmailSendInput = {
  channel: "email";
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
};

export type WhatsAppSendInput = {
  channel: "whatsapp";
  to: string;
  templateName: string;
  variables: string[];
};

export type DiscordSendInput = {
  channel: "discord";
  webhookUrl: string;
  title: string;
  description: string;
  mentionIds?: string[];
};

export type ChannelSendInput = EmailSendInput | WhatsAppSendInput | DiscordSendInput;

export type ChannelResult =
  | { ok: true; externalId: string | null }
  | { ok: false; kind: "transient" | "permanent"; status: number | null; message: string };

export function isChannelOk(result: ChannelResult): result is Extract<ChannelResult, { ok: true }> {
  return result.ok === true;
}
