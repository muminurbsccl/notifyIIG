import "server-only";
import { getPublicConfig } from "@/lib/config";

export function getServerConfig() {
  return {
    ...getPublicConfig(),
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null,
    cronSecret: process.env.CRON_SECRET?.trim() || null,
    appBaseUrl: process.env.APP_BASE_URL?.trim() || null,
    appEncryptionKey: process.env.APP_ENCRYPTION_KEY?.trim() || null,
    emailApiUrl: process.env.EMAIL_API_URL?.trim() || null,
    emailApiKey: process.env.EMAIL_API_KEY?.trim() || null,
    emailFrom: process.env.EMAIL_FROM?.trim() || null,
    emailFromName: process.env.EMAIL_FROM_NAME?.trim() || null,
    whatsappApiVersion: process.env.WHATSAPP_API_VERSION?.trim() || "v22.0",
    whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN?.trim() || null,
    whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || null,
    whatsappTemplateName: process.env.WHATSAPP_TEMPLATE_NAME?.trim() || null,
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL?.trim() || null,
  };
}
