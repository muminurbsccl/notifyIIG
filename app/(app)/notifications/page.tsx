import { DeliveriesTable, type DeliveryRow } from "@/components/deliveries-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { requireProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 200;

export default async function NotificationsPage() {
  const auth = await requireProfile();
  const canResend = auth.profile.role === "admin" || auth.profile.role === "operations_editor";

  const { data: events, error: eventsError } = await auth.supabase
    .from("notification_events")
    .select("id,circuit_id,milestone_key,due_date,status,expiry_version")
    .order("generated_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (eventsError) throw eventsError;

  const eventIds = (events ?? []).map((event) => event.id);
  const { data: deliveries, error: deliveriesError } = await auth.supabase
    .from("notification_deliveries")
    .select("id,event_id,channel,masked_target,status,attempts,next_attempt_at,external_message_id,created_at")
    .in("event_id", eventIds)
    .order("created_at", { ascending: false });
  if (deliveriesError) throw deliveriesError;

  const circuitIds = [...new Set((events ?? []).map((event) => String(event.circuit_id)))];
  const { data: circuits, error: circuitsError } = await auth.supabase
    .from("circuits")
    .select("id,external_circuit_id")
    .in("id", circuitIds);
  if (circuitsError) throw circuitsError;
  const circuitById = new Map((circuits ?? []).map((circuit) => [circuit.id, circuit.external_circuit_id]));

  const eventById = new Map((events ?? []).map((event) => [event.id, event]));

  const rows: DeliveryRow[] = (deliveries ?? []).map((delivery) => {
    const event = eventById.get(delivery.event_id);
    return {
      id: String(delivery.id),
      eventId: String(delivery.event_id),
      circuitId: event ? circuitById.get(event.circuit_id) ?? null : null,
      milestoneKey: event ? String(event.milestone_key) : null,
      dueDate: event ? String(event.due_date) : null,
      eventStatus: event ? String(event.status) : null,
      channel: String(delivery.channel),
      maskedTarget: String(delivery.masked_target),
      status: String(delivery.status),
      attempts: Number(delivery.attempts ?? 0),
      nextAttemptAt: delivery.next_attempt_at ? String(delivery.next_attempt_at) : null,
      externalMessageId: delivery.external_message_id ? String(delivery.external_message_id) : null,
      createdAt: String(delivery.created_at),
    };
  });

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Notifications</h1>
        </div>
      </header>

      {(events ?? []).length > 0 && (
        <>
          <h2 className="section-heading">Events</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Circuit</th>
                  <th>Milestone</th>
                  <th>Due date</th>
                  <th>Status</th>
                  <th>Expiry version</th>
                </tr>
              </thead>
              <tbody>
                {(events ?? []).map((event) => (
                  <tr key={event.id}>
                    <td>{circuitById.get(event.circuit_id) ?? "—"}</td>
                    <td>{String(event.milestone_key)}</td>
                    <td>{String(event.due_date)}</td>
                    <td>
                      <StatusBadge status={String(event.status)} />
                    </td>
                    <td>{String(event.expiry_version)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 className="section-heading">Deliveries</h2>
      {(events ?? []).length === 0 ? (
        <EmptyState
          message="The notification job has not created any events yet."
          title="No notifications yet"
        />
      ) : (
        <DeliveriesTable canResend={canResend} deliveries={rows} />
      )}
    </>
  );
}
