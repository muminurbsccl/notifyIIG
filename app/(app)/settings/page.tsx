import { ChannelTestForm } from "@/components/channel-test-form";
import { requireProfile } from "@/lib/auth";
import { getServerConfig } from "@/lib/server-config";

export const dynamic = "force-dynamic";

type Gate = { label: string; configured: boolean; note?: string };

export default async function SettingsPage() {
  const auth = await requireProfile();
  const config = getServerConfig();
  const isAdmin = auth.profile.role === "admin";

  const gates: Gate[] = [
    { label: "Supabase project", configured: Boolean(config.supabaseUrl && config.supabaseAnonKey) },
    { label: "Service role key", configured: Boolean(config.serviceRoleKey), note: "Server-only; used for imports and audit writes" },
    { label: "Cron secret", configured: Boolean(config.cronSecret), note: "Protects the scheduled notification job" },
    { label: "Notification encryption key", configured: Boolean(config.appEncryptionKey), note: "Encrypts stored notification targets" },
    { label: "Email channel", configured: Boolean(config.emailApiUrl && config.emailApiKey && config.emailFrom) },
    { label: "WhatsApp channel", configured: Boolean(config.whatsappAccessToken && config.whatsappPhoneNumberId) },
    { label: "Discord channel", configured: Boolean(config.discordWebhookUrl) },
  ];

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Settings</h1>
        </div>
      </header>

      <div className="data-card">
        <h2 className="section-heading">Service configuration</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {gates.map((gate) => (
                <tr key={gate.label}>
                  <td>{gate.label}</td>
                  <td>{gate.configured ? "Configured" : "Not configured"}</td>
                  <td className="muted">{gate.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted form-help stack-gap">
          Secret values are never shown here. Configure them through deployment environment variables.
        </p>
      </div>

      {isAdmin && (
        <div className="data-card stack-gap">
          <h2 className="section-heading">Channel test</h2>
          <p className="muted">Send a test message to a target you control.</p>
          <ChannelTestForm />
        </div>
      )}
    </>
  );
}
