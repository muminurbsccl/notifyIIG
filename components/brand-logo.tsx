import type { ReactElement } from "react";

type BrandLogoProps = {
  compact?: boolean;
};

export function BrandLogo({ compact = false }: BrandLogoProps): ReactElement {
  return (
    <div className={`brand-lockup${compact ? " brand-lockup-compact" : ""}`}>
      <span className="brand-mark" aria-hidden="true">
        B
      </span>
      <span className="brand-copy">
        <strong>BSCPLC</strong>
        {!compact && <small>Circuit notifications</small>}
      </span>
    </div>
  );
}
