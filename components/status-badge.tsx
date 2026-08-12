import type { ReactElement } from "react";

const TONES: Record<string, string> = {
  active: "success",
  renewed: "info",
  renewal_pending: "gold",
  draft: "neutral",
  expired: "danger",
  terminated: "danger",
  archived: "neutral",
  queued: "neutral",
  pending: "gold",
  sent: "success",
  delivered: "success",
  retry_scheduled: "gold",
  permanent_failure: "danger",
  suppressed: "neutral",
  completed: "success",
  no_action: "neutral",
  reviewing: "gold",
  renewal_requested: "gold",
  renewal_confirmed: "success",
  termination_planned: "danger",
  closed: "neutral",
};

type StatusBadgeProps = {
  status: string;
  label?: string;
};

export function StatusBadge({ status, label }: StatusBadgeProps): ReactElement {
  const tone = TONES[status] ?? "neutral";
  return (
    <span className={`badge badge-${tone}`} role="status">
      {label ?? status}
    </span>
  );
}
