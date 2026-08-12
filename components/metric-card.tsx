import type { ReactElement } from "react";

type MetricCardProps = {
  label: string;
  value: string | number;
  hint?: string;
};

export function MetricCard({ label, value, hint }: MetricCardProps): ReactElement {
  return (
    <div className="metric-card">
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
      {hint && <p className="muted metric-hint">{hint}</p>}
    </div>
  );
}
