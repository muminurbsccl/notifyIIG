import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { BrandLogo } from "@/components/brand-logo";

type AppShellProps = {
  children: ReactNode;
  userLabel: string;
  role: string;
  setupWarning?: string | null;
};

const navigation = [
  ["Dashboard", "/dashboard"],
  ["Circuits", "/circuits"],
  ["Providers", "/providers"],
  ["Imports", "/imports"],
  ["Notifications", "/notifications"],
  ["Settings", "/settings"],
  ["Audit log", "/audit"],
] as const;

export function AppShell({ children, userLabel, role, setupWarning = null }: AppShellProps): ReactElement {
  return (
    <div className="app-frame">
      <aside className="sidebar" aria-label="Primary navigation">
        <Link className="sidebar-brand" href="/dashboard" aria-label="BSCPLC dashboard">
          <BrandLogo compact />
        </Link>
        <nav className="nav-list">
          {navigation.map(([label, href]) => (
            <Link aria-label={label} className="nav-link" href={href} key={href}>
              <span aria-hidden="true" className="nav-dot" />
              <span className="nav-label">{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span
            className={`status-dot ${setupWarning ? "status-dot-warning" : "status-dot-success"}`}
            aria-hidden="true"
          />
          <span title={setupWarning ?? undefined}>
            {setupWarning ? "Setup incomplete — check Settings" : "All services configured"}
          </span>
        </div>
      </aside>
      <div className="app-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">BSCPLC operations</p>
            <p className="topbar-title">Circuit expiry notification system</p>
          </div>
          <div className="user-chip" aria-label={`Signed in as ${userLabel}, ${role}`}>
            <span className="avatar" aria-hidden="true">
              {userLabel.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{userLabel}</strong>
              <small>{role}</small>
            </span>
          </div>
        </header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
