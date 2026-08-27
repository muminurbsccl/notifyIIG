import { EmptyState } from "@/components/empty-state";
import { MetricCard } from "@/components/metric-card";
import { NoticeDateCell } from "@/components/notice-date-cell";
import { StatusBadge } from "@/components/status-badge";
import { requireProfile } from "@/lib/auth";
import { listCircuits, listProviders } from "@/lib/data";
import {
  addCalendarDays,
  addCalendarMonths,
  formatMonthLabel,
  getDhakaBusinessDate,
  toDateOnly,
} from "@/lib/domain/date-rules";
import { isNoticeOverdue, noticeDate } from "@/lib/domain/notice-date";

export const dynamic = "force-dynamic";

const OPERATIONAL_STATUSES = new Set(["active", "renewal_pending", "renewed"]);

export default async function DashboardPage() {
  const auth = await requireProfile();
  const [circuits, providers, failedNotificationsResult] = await Promise.all([
    listCircuits(auth.supabase, {}),
    listProviders(auth.supabase, undefined, { cacheKey: auth.profile.id }),
    auth.supabase
      .from("notification_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("status", "permanent_failure"),
  ]);
  if (failedNotificationsResult.error) throw failedNotificationsResult.error;
  const failedNotifications = failedNotificationsResult.count;

  const businessDate = getDhakaBusinessDate();
  const activeCircuits = circuits.filter((circuit) => circuit.status === "active");
  // Operational scope mirrors notification engine (expired/draft/terminated are not "upcoming")
  const operationalCircuits = circuits.filter((c) => OPERATIONAL_STATUSES.has(c.status));
  const fourMonthsLimit = addCalendarMonths(businessDate, 4);
  const thirtyDaysLimit = addCalendarDays(businessDate, 30);
  const expiringInFourMonths = operationalCircuits.filter((circuit) => {
    if (!circuit.expiry_date) return false;
    const expiry = toDateOnly(circuit.expiry_date);
    return expiry >= businessDate && expiry <= fourMonthsLimit;
  });
  const expiringInThirtyDays = operationalCircuits.filter((circuit) => {
    if (!circuit.expiry_date) return false;
    const expiry = toDateOnly(circuit.expiry_date);
    return expiry >= businessDate && expiry <= thirtyDaysLimit;
  });
  const missingExpiry = circuits.filter((circuit) => !circuit.expiry_date);

  const upcoming = operationalCircuits
    .filter((circuit) => {
      if (!circuit.expiry_date) return false;
      return toDateOnly(circuit.expiry_date) >= businessDate;
    })
    .sort((a, b) => {
      const aOverdue = isNoticeOverdue(a, businessDate);
      const bOverdue = isNoticeOverdue(b, businessDate);
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
      if (aOverdue && bOverdue) {
        return String(noticeDate(a)).localeCompare(String(noticeDate(b)));
      }
      return toDateOnly(String(a.expiry_date)).localeCompare(toDateOnly(String(b.expiry_date)));
    });

  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const exposure = [...providerById.values()]
    .map((provider) => {
      const owned = circuits.filter((circuit) => circuit.provider_id === provider.id);
      const operationalOwned = owned.filter((c) => OPERATIONAL_STATUSES.has(c.status));
      return {
        provider,
        active: operationalOwned.filter((circuit) => circuit.status === "active").length,
        total: operationalOwned.length,
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
                    <td>{formatMonthLabel(circuit.expiry_date ?? "")}</td>
                    <td>{circuit.external_circuit_id}</td>
                    <td>{providerById.get(circuit.provider_id)?.name ?? "—"}</td>
                    <td>
                      <StatusBadge status={circuit.status} />
                    </td>
                    <td>{circuit.expiry_date ? toDateOnly(circuit.expiry_date) : "—"}</td>
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
