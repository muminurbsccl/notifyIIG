import { ImportWorkflow } from "@/components/import-workflow";
import { requireProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  const auth = await requireProfile();
  const canManage = auth.profile.role === "admin" || auth.profile.role === "operations_editor";

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Bulk operations</p>
          <h1>Imports</h1>
        </div>
      </header>
      {canManage ? (
        <ImportWorkflow />
      ) : (
        <p className="muted">
          Import review and commit require an administrator or operations editor role.
        </p>
      )}
    </>
  );
}
