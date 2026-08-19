import type { ReactElement } from "react";
import { BrandLogo } from "@/components/brand-logo";

export function LoginBrandPanel(): ReactElement {
  return (
    <aside className="login-brand">
      <div className="login-brand-top">
        <BrandLogo />
        <h1 id="login-title">BSCPLC IPT NotifySystem</h1>
        <p className="login-brand-tagline">Notification system for service renewal</p>
      </div>
      <p className="login-brand-footer">Bangladesh Submarine Cable PLC</p>
    </aside>
  );
}
