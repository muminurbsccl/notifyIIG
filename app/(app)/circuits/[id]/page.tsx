import Link from "next/link";
import { notFound } from "next/navigation";
import { CircuitForm } from "@/components/circuit-form";
import { StatusBadge } from "@/components/status-badge";
import { requireProfile } from "@/lib/auth";
import { getCircuit, listProviders } from "@/lib/data";
import { listActiveProfiles } from "@/lib/admin-profiles";

export const dynamic = "force-dynamic";

export default async function CircuitDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await requireProfile();
  const { id } = await params;
  const circuit = await getCircuit(auth.supabase, auth.profile, id);
  if (!circuit) notFound();

  const [providers, profiles] = await Promise.all([
    listProviders(auth.supabase, undefined, { cacheKey: auth.profile.id }),
    listActiveProfiles(),
  ]);
  const provider = providers.find((entry) => entry.id === circuit.provider_id);
  const canManage = auth.profile.role === "admin" || auth.profile.role === "operations_editor";
  const isManager = auth.profile.role === "provider_manager";

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Registry</p>
          <h1>{circuit.external_circuit_id}</h1>
        </div>
        <Link className="button button-secondary" href="/circuits">
          Back to circuits
        </Link>
      </header>

      <div className="data-card">
        <dl className="detail-grid">
          <div>
            <dt>Provider</dt>
            <dd>{provider?.name ?? "—"}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <StatusBadge status={circuit.status} />
            </dd>
          </div>
          <div>
            <dt>Action status</dt>
            <dd>
              <StatusBadge status={circuit.action_status} />
            </dd>
          </div>
          <div>
            <dt>Expiry date</dt>
            <dd>{circuit.expiry_date ?? "—"}</dd>
          </div>
          <div>
            <dt>Start date</dt>
            <dd>{circuit.start_date ?? "—"}</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>{circuit.owner_override || circuit.owner_user_id || "—"}</dd>
          </div>
          <div>
            <dt>Backup owner</dt>
            <dd>{circuit.backup_owner_user_id ?? "—"}</dd>
          </div>
          <div>
            <dt>Identifier type</dt>
            <dd>{circuit.identifier_type}</dd>
          </div>
          <div>
            <dt>Capacity</dt>
            <dd>{circuit.capacity ?? "—"}</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>{circuit.location ?? "—"}</dd>
          </div>
          <div>
            <dt>Monthly cost</dt>
            <dd>
              {circuit.monthly_cost === null || circuit.monthly_cost === undefined
                ? "—"
                : `${circuit.currency ?? ""} ${circuit.monthly_cost}`.trim()}
            </dd>
          </div>
          <div>
            <dt>Notifications</dt>
            <dd>{circuit.notification_enabled ? "Enabled" : "Disabled"}</dd>
          </div>
          <div>
            <dt>Verified</dt>
            <dd>
              {circuit.verified_at ? `${circuit.verified_at}${circuit.verified_by ? ` by ${circuit.verified_by}` : ""}` : "Not verified"}
            </dd>
          </div>
          <div>
            <dt>Expiry version</dt>
            <dd>{circuit.expiry_version}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{circuit.updated_at}</dd>
          </div>
        </dl>
        {circuit.notes && <p className="muted stack-gap">{circuit.notes}</p>}
      </div>

      {canManage || isManager ? (
        <div className="data-card stack-gap">
          <h2 className="section-heading">Edit circuit</h2>
          <CircuitForm
            circuitId={circuit.id}
            initial={{
              providerId: circuit.provider_id,
              externalCircuitId: circuit.external_circuit_id,
              identifierType: circuit.identifier_type,
              serviceType: circuit.service_type,
              capacity: circuit.capacity,
              location: circuit.location,
              startDate: circuit.start_date,
              expiryDate: circuit.expiry_date,
              status: circuit.status,
              actionStatus: circuit.action_status,
              ownerOverride: circuit.owner_override,
              ownerUserId: circuit.owner_user_id,
              backupOwnerUserId: circuit.backup_owner_user_id,
              monthlyCost: circuit.monthly_cost,
              currency: circuit.currency,
              notes: circuit.notes,
              notificationEnabled: circuit.notification_enabled,
              notificationRuleId: circuit.notification_rule_id,
            }}
            managerMode={isManager}
            providers={providers.map((entry) => ({ id: entry.id, name: entry.name, code: entry.code }))}
            profiles={profiles}
            submitLabel="Save changes"
          />
        </div>
      ) : (
        <p className="muted stack-gap">
          Your role cannot edit this circuit.
        </p>
      )}
    </>
  );
}
