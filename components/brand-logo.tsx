import Image from "next/image";
import type { ReactElement } from "react";

type BrandLogoProps = {
  compact?: boolean;
};

export function BrandLogo({ compact = false }: BrandLogoProps): ReactElement {
  return (
    <div className={`brand-lockup${compact ? " brand-lockup-compact" : ""}`}>
      <Image
        alt="BSCPLC logo"
        className="brand-logo-image"
        height={56}
        priority
        src="/brand/bscplc-logo.webp"
        width={180}
      />
      <span className="brand-copy">
        <strong>BSCPLC</strong>
        {!compact && <small>Circuit notifications</small>}
      </span>
    </div>
  );
}
