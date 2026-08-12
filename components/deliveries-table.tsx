"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ResendDialog } from "@/components/resend-dialog";

export type DeliveryRow = {
  id: string;
  eventId: string;
  circuitId: string | null;
  milestoneKey: string | null;
  dueDate: string | null;
  eventStatus: string | null;
  channel: string;
  maskedTarget: string;
  status: string;
  attempts: number;
  nextAttemptAt: string | null;
  externalMessageId: string | null;
  createdAt: string;
};

const DELIVERY_STATUS_TONE: Record<string, string> = {
  queued: "neutral",
  sending: "info",
  sent: "success",
  delivered: "success",
  retry_scheduled: "gold",
  permanent_failure: "danger",
  suppressed: "neutral",
};

export function DeliveriesTable({ deliveries, canResend }: { deliveries: DeliveryRow[]; canResend: boolean }) {
  const router = useRouter();
  const [resendId, setResendId] = useState<string | null>(null);
  const resendDelivery = deliveries.find((delivery) => delivery.id === resendId);

  return (
    <>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Circuit</th>
              <th>Milestone</th>
              <th>Due</th>
              <th>Channel</th>
              <th>Target</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Next attempt</th>
              <th>External ID</th>
              <th>Created</th>
              {canResend && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {deliveries.map((delivery) => (
              <tr key={delivery.id}>
                <td>{delivery.circuitId ?? "—"}</td>
                <td>{delivery.milestoneKey ?? "—"}</td>
                <td>{delivery.dueDate ?? "—"}</td>
                <td>{delivery.channel}</td>
                <td>{delivery.maskedTarget}</td>
                <td>
                  <span className={`badge badge-${DELIVERY_STATUS_TONE[delivery.status] ?? "neutral"}`}>
                    {delivery.status}
                  </span>
                </td>
                <td>{delivery.attempts}</td>
                <td>{delivery.nextAttemptAt ?? "—"}</td>
                <td>{delivery.externalMessageId ?? "—"}</td>
                <td>{delivery.createdAt}</td>
                {canResend && (
                  <td>
                    <button
                      className="button button-secondary button-small"
                      onClick={() => setResendId(delivery.id)}
                      type="button"
                    >
                      Resend
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {deliveries.length === 0 && <p className="muted stack-gap">No notification deliveries recorded yet.</p>}
      {resendDelivery && (
        <ResendDialog
          deliveryId={resendDelivery.id}
          maskedTarget={resendDelivery.maskedTarget}
          onClose={() => setResendId(null)}
          onDone={() => {
            setResendId(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
