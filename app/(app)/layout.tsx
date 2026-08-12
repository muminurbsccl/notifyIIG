import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireProfile } from "@/lib/auth";
import { getServerConfig } from "@/lib/server-config";

export const dynamic = "force-dynamic";

function buildSetupWarning(): string | null {
  const config = getServerConfig();
  const missing: string[] = [];
  if (!config.serviceRoleKey) missing.push("service role key");
  if (!config.cronSecret) missing.push("cron secret");
  if (!config.appEncryptionKey) missing.push("encryption key");
  if (!config.emailApiUrl || !config.emailApiKey || !config.emailFrom) missing.push("email");
  if (!config.whatsappAccessToken || !config.whatsappPhoneNumberId) missing.push("whatsapp");
  if (!config.discordWebhookUrl) missing.push("discord");
  return missing.length > 0 ? `Setup incomplete: ${missing.join(", ")}` : null;
}

export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const auth = await requireProfile();
  const userLabel = auth.profile.full_name || auth.profile.email || "User";
  return (
    <AppShell setupWarning={buildSetupWarning()} userLabel={userLabel} role={auth.profile.role}>
      {children}
    </AppShell>
  );
}
