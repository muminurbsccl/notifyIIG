import "server-only";
import type { ChannelResult, ChannelSendInput } from "./types";
import { sendEmail } from "./email";
import { sendWhatsApp } from "./whatsapp";
import { sendDiscord } from "./discord";

export async function dispatchChannel(input: ChannelSendInput): Promise<ChannelResult> {
  switch (input.channel) {
    case "email":
      return sendEmail(input);
    case "whatsapp":
      return sendWhatsApp(input);
    case "discord":
      return sendDiscord(input);
  }
}
