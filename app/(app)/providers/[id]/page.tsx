import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { ProviderForm } from "@/components/provider-form";
import { StatusBadge } from "@/components/status-badge";
import { requireProfile } from "@/lib/auth";
import { listCircuits, listProviders } from "@/lib/data";
import { listActiveProfiles } from "@/lib/admin-profiles";

export const dynamic = "force-dynamic";

export default async function ProviderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await requireProfile();
  const { id } = await params;
  const providers = await listProviders(auth.supabase);
  const provider = providers.find((entry) => entry.id === id);
  if (!provider) notFound();

  const canManage = auth.profile.role === "admin" || auth.profile.role === "operations_editor";
  const circuits = await listCircuits(auth.supabase, { providerId: id });
  const profiles = canManage ? await listActiveProfiles() : [];

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Registry</p>
          <h1>{provider.name}</h1>
        </div>
        <Link className="button button-secondary" href="/providers">
          Back to providers
        </Link>
      </header>

      <div className="data-card">
        <dl className="detail-grid">
          <div>
            <dt>Code</dt>
            <dd>{provider.code}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{provider.active ? "Active" : "Inactive"}</dd>
          </div>
          <div>
            <dt>Default responsible officer</dt>
            <dd>{provider.default_responsible_officer ?? "—"}</dd>
          </div>
          <div>
            <dt>Primary owner</dt>
            <dd>{provider.primary_owner_user_id ?? "—"}</dd>
          </div>
          <div>
            <dt>Backup owner</dt>
            <dd>{provider.backup_owner_user_id ?? "—"}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{provider.updated_at}</dd>
          </div>
        </dl>
        {provider.notes && <p className="muted stack-gap">{provider.notes}</p>}
      </div>

      {canManage && (
        <div className="data-card stack-gap">
          <h2 className="section-heading">Edit provider</h2>
          <ProviderForm
            initial={{
              code: provider.code,
              name: provider.name,
              active: provider.active,
              defaultResponsibleOfficer: provider.default_responsible_officer,
              primaryOwnerUserId: provider.primary_owner_user_id,
              backupOwnerUserId: provider.backup_owner_user_id,
              notes: provider.notes,
            }}
            providerId={provider.id}
            profiles={profiles}
            submitLabel="Save changes"
          />
        </div>
      )}

      <h2 className="section-heading">Circuits</h2>
      {circuits.length === 0 ? (
        <EmptyState
          actionHref={canManage ? "/circuits/new" : undefined}
          actionLabel={canManage ? "Add a circuit" : undefined}
          message="No circuits are registered under this provider."
          title="No circuits"
        />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Circuit</th>
                <th>Status</th>
                <th>Action</th>
                <th>Expiry date</th>
                <th>Notifications</th>
              </tr>
            </thead>
            <tbody>
              {circuits.map((circuit) => (
                <tr key={circuit.id}>
                  <td>
                    <Link href={`/circuits/${circuit.id}`}>{circuit.external_circuit_id}</Link>
                  </td>
                  <td>
                    <StatusBadge status={circuit.status} />
                  </td>
                  <td>
                    <StatusBadge status={circuit.action_status} />
                  </td>
                  <td>{circuit.expiry_date ?? "—"}</td>
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
