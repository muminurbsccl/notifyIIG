import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { ProviderForm } from "@/components/provider-form";
import { requireProfile } from "@/lib/auth";
import { listProviders } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ProvidersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  const auth = await requireProfile();
  const params = await searchParams;
  const canManage = auth.profile.role === "admin" || auth.profile.role === "operations_editor";
  const providers = await listProviders(auth.supabase, params.search);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Registry</p>
          <h1>Providers</h1>
        </div>
      </header>

      <form className="filter-bar" method="get" action="/providers">
        <label className="sr-only" htmlFor="provider-search">
          Search providers
        </label>
        <input
          defaultValue={params.search ?? ""}
          id="provider-search"
          name="search"
          placeholder="Search by name…"
          type="search"
        />
        <button className="button button-secondary" type="submit">
          Filter
        </button>
      </form>

      {providers.length === 0 ? (
        <EmptyState
          actionHref={canManage ? "/providers" : undefined}
          actionLabel={canManage ? "Register the first provider" : undefined}
          message="No providers match the current filters."
          title="No providers found"
        />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Code</th>
                <th>Status</th>
                <th>Responsible officer</th>
                <th>Circuits</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr key={provider.id}>
                  <td>
                    <Link href={`/providers/${provider.id}`}>{provider.name}</Link>
                  </td>
                  <td>{provider.code}</td>
                  <td>{provider.active ? "Active" : "Inactive"}</td>
                  <td>{provider.default_responsible_officer ?? "—"}</td>
                  <td>
                    <Link href={`/circuits?providerId=${provider.id}`}>View circuits</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage && (
        <div className="data-card stack-gap">
          <h2 className="section-heading">Register a provider</h2>
          <ProviderForm submitLabel="Save provider" />
        </div>
      )}
    </>
  );
}
