import { EmptyState } from "@/components/empty-state";
import { requireProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 200;

export default async function AuditPage() {
  const auth = await requireProfile();
  const { data: entries, error } = await auth.supabase
    .from("audit_logs")
    .select("id,actor_user_id,action,entity_type,entity_id,before_json,after_json,created_at")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (error) throw error;

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Compliance</p>
          <h1>Audit log</h1>
        </div>
      </header>

      {(entries ?? []).length === 0 ? (
        <EmptyState message="Audit entries will appear here as actions are recorded." title="No audit entries yet" />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Change summary</th>
              </tr>
            </thead>
            <tbody>
              {(entries ?? []).map((entry) => (
                <tr key={entry.id}>
                  <td>{String(entry.created_at)}</td>
                  <td>{String(entry.actor_user_id ?? "system").slice(0, 8)}</td>
                  <td>{String(entry.action)}</td>
                  <td>
                    {String(entry.entity_type)}
                    {entry.entity_id ? ` · ${String(entry.entity_id).slice(0, 8)}` : ""}
                  </td>
                  <td className="muted">
                    {entry.after_json ? JSON.stringify(entry.after_json).slice(0, 160) : entry.before_json ? "Removed" : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
