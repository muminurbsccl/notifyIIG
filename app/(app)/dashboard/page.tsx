import { EmptyState } from "@/components/empty-state";
import { MetricCard } from "@/components/metric-card";
import { NoticeDateCell } from "@/components/notice-date-cell";
import { StatusBadge } from "@/components/status-badge";
import { requireProfile } from "@/lib/auth";
import { listCircuits, listProviders } from "@/lib/data";
import { getDhakaBusinessDate } from "@/lib/domain/date-rules";
import { isNoticeOverdue, noticeDate } from "@/lib/domain/notice-date";

export const dynamic = "force-dynamic";

function addCalendarMonths(value: string, months: number): string {
  const [y, m, d] = value.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(d, new Date(Date.UTC(year, month, 0)).getUTCDate());
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addCalendarDays(value: string, days: number): string {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

function monthLabel(value: string): string {
  const [y, m] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function DashboardPage() {
  const auth = await requireProfile();
  const circuits = await listCircuits(auth.supabase, {});
  const providers = await listProviders(auth.supabase);

  const { count: failedNotifications, error: failedError } = await auth.supabase
    .from("notification_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("status", "permanent_failure");
  if (failedError) throw failedError;

  const businessDate = getDhakaBusinessDate();
  const activeCircuits = circuits.filter((circuit) => circuit.status === "active");
  const expiringInFourMonths = circuits.filter(
    (circuit) =>
      circuit.expiry_date &&
      circuit.expiry_date >= businessDate &&
      circuit.expiry_date <= addCalendarMonths(businessDate, 4),
  );
  const expiringInThirtyDays = circuits.filter(
    (circuit) =>
      circuit.expiry_date &&
      circuit.expiry_date >= businessDate &&
      circuit.expiry_date <= addCalendarDays(businessDate, 30),
  );
  const missingExpiry = circuits.filter((circuit) => !circuit.expiry_date);

  const upcoming = circuits
    .filter((circuit) => circuit.expiry_date && circuit.expiry_date >= businessDate)
    .sort((a, b) => {
      const aOverdue = isNoticeOverdue(a, businessDate);
      const bOverdue = isNoticeOverdue(b, businessDate);
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
      if (aOverdue && bOverdue) {
        return String(noticeDate(a)).localeCompare(String(noticeDate(b)));
      }
      return String(a.expiry_date).localeCompare(String(b.expiry_date));
    });

  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const exposure = [...providerById.values()]
    .map((provider) => {
      const owned = circuits.filter((circuit) => circuit.provider_id === provider.id);
      return {
        provider,
        active: owned.filter((circuit) => circuit.status === "active").length,
        total: owned.length,
      };
    })
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.active - a.active);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Operations overview</p>
          <h1>Dashboard</h1>
        </div>
      </header>

      <div className="metric-grid">
        <MetricCard hint={`of ${circuits.length} circuits`} label="Active circuits" value={activeCircuits.length} />
        <MetricCard hint="from today" label="Expiring within 4 months" value={expiringInFourMonths.length} />
        <MetricCard hint="from today" label="Expiring within 30 days" value={expiringInThirtyDays.length} />
        <MetricCard hint="cannot send notifications" label="Missing expiry date" value={missingExpiry.length} />
        <MetricCard hint="terminal failures" label="Failed notifications" value={failedNotifications ?? 0} />
      </div>

      {upcoming.length === 0 ? (
        <EmptyState
          message="Circuits with an expiry date on or after today will appear here."
          title="No upcoming expiries"
        />
      ) : (
        <>
          <h2 className="section-heading">Upcoming expiries</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Due</th>
                  <th>Circuit</th>
                  <th>Provider</th>
                  <th>Status</th>
                  <th>Expiry date</th>
                  <th>Notice date</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((circuit) => (
                  <tr key={circuit.id}>
                    <td>{monthLabel(circuit.expiry_date ?? "")}</td>
                    <td>{circuit.external_circuit_id}</td>
                    <td>{providerById.get(circuit.provider_id)?.name ?? "—"}</td>
                    <td>
                      <StatusBadge status={circuit.status} />
                    </td>
                    <td>{circuit.expiry_date}</td>
                    <NoticeDateCell circuit={circuit} businessDate={businessDate} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {exposure.length > 0 && (
        <>
          <h2 className="section-heading">Provider exposure</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Active circuits</th>
                  <th>Total circuits</th>
                </tr>
              </thead>
              <tbody>
                {exposure.map(({ provider, active, total }) => (
                  <tr key={provider.id}>
                    <td>{provider.name}</td>
                    <td>{active}</td>
                    <td>{total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
