import Link from "next/link";
import type { ReactElement } from "react";

type EmptyStateProps = {
  title: string;
  message: string;
  actionHref?: string;
  actionLabel?: string;
};

export function EmptyState({ title, message, actionHref, actionLabel }: EmptyStateProps): ReactElement {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p className="muted">{message}</p>
      {actionHref && actionLabel && (
        <Link className="button button-primary" href={actionHref}>
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
