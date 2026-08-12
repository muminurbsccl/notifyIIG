import { Suspense } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { LoginForm } from "@/components/login-form";
import { getPublicConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const configured = getPublicConfig().configured;
  return (
    <main className="setup-page">
      <section className="setup-card login-card" aria-labelledby="login-title">
        <BrandLogo />
        <p className="eyebrow">Invitation-only access</p>
        <h1 id="login-title">Sign in to circuit operations</h1>
        {!configured ? (
          <div className="notice notice-warning">
            Supabase is not configured for this deployment. <Link href="/setup">Open setup guidance</Link>.
          </div>
        ) : (
          <Suspense fallback={<p className="muted">Loading sign-in…</p>}>
            <LoginForm />
          </Suspense>
        )}
      </section>
    </main>
  );
}
