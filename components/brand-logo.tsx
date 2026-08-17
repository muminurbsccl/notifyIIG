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
        height={295}
        priority
        src="/brand/bscplc-logo.jpg"
        width={320}
      />
    </div>
  );
}
