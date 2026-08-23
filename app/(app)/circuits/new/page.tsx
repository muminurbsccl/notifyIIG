import Link from "next/link";
import { CircuitForm } from "@/components/circuit-form";
import { EmptyState } from "@/components/empty-state";
import { requireProfile } from "@/lib/auth";
import { listProviders } from "@/lib/data";
import { listActiveProfiles } from "@/lib/admin-profiles";

export const dynamic = "force-dynamic";

export default async function NewCircuitPage() {
  const auth = await requireProfile(["admin", "operations_editor"]);
  const providers = await listProviders(auth.supabase);
  const profiles = await listActiveProfiles();

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Registry</p>
          <h1>New circuit</h1>
        </div>
      </header>
      {providers.length === 0 ? (
        <EmptyState
          actionHref="/providers"
          actionLabel="Add a provider first"
          message="Circuits must belong to a provider. Register the provider before adding circuits."
          title="No providers yet"
        />
      ) : (
        <CircuitForm
          providers={providers.map((provider) => ({ id: provider.id, name: provider.name, code: provider.code }))}
          profiles={profiles}
          submitLabel="Save circuit"
        />
      )}
    </>
  );
}
