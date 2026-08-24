import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { requireProfile } from "@/lib/auth";
import { listCircuits, listProviders } from "@/lib/data";
import { NoticeDateCell } from "@/components/notice-date-cell";
import { getDhakaBusinessDate } from "@/lib/domain/date-rules";

export const dynamic = "force-dynamic";

const STATUS_OPTIONS = ["active", "renewal_pending", "renewed", "draft", "expired", "terminated", "archived"];

export default async function CircuitsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string }>;
}) {
  const auth = await requireProfile();
  const params = await searchParams;
  const canManage = auth.profile.role === "admin" || auth.profile.role === "operations_editor";
  const [circuits, providers] = await Promise.all([
    listCircuits(auth.supabase, {
      search: params.search,
      status: params.status,
    }),
    listProviders(auth.supabase, undefined, { cacheKey: auth.profile.id }),
  ]);
  const businessDate = getDhakaBusinessDate();
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Registry</p>
          <h1>Circuits</h1>
        </div>
        {canManage && (
          <Link className="button button-primary" href="/circuits/new">
            New circuit
          </Link>
        )}
      </header>

      <form className="filter-bar" method="get" action="/circuits">
        <label className="sr-only" htmlFor="circuit-search">
          Search circuits
        </label>
        <input
          defaultValue={params.search ?? ""}
          id="circuit-search"
          name="search"
          placeholder="Search by circuit ID…"
          type="search"
        />
        <label className="sr-only" htmlFor="circuit-status">
          Status
        </label>
        <select defaultValue={params.status ?? ""} id="circuit-status" name="status">
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <button className="button button-secondary" type="submit">
          Filter
        </button>
      </form>

      {circuits.length === 0 ? (
        <EmptyState
          actionHref={canManage ? "/circuits/new" : undefined}
          actionLabel={canManage ? "Register the first circuit" : undefined}
          message="No circuits match the current filters."
          title="No circuits found"
        />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Circuit</th>
                <th>Provider</th>
                <th>Status</th>
                <th>Action</th>
                <th>Owner</th>
                <th>Expiry date</th>
                <th>Notice date</th>
                <th>Notifications</th>
              </tr>
            </thead>
            <tbody>
              {circuits.map((circuit) => (
                <tr key={circuit.id}>
                  <td>
                    <Link href={`/circuits/${circuit.id}`}>{circuit.external_circuit_id}</Link>
                  </td>
                  <td>{providerById.get(circuit.provider_id)?.name ?? "—"}</td>
                  <td>
                    <StatusBadge status={circuit.status} />
                  </td>
                  <td>
                    <StatusBadge status={circuit.action_status} />
                  </td>
                  <td>{circuit.owner_override || circuit.owner_user_id || "—"}</td>
                  <td>{circuit.expiry_date ?? "—"}</td>
                  <NoticeDateCell circuit={circuit} businessDate={businessDate} />
                  <td>{circuit.notification_enabled ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
