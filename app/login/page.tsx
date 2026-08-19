import Link from "next/link";
import type { Metadata } from "next";
import { BrandLogo } from "@/components/brand-logo";
import { LoginForm } from "@/components/login-form";
import { getPublicConfig } from "@/lib/config";
import { PUBLIC_OPEN_GRAPH } from "@/lib/public-metadata";

type LoginPageProps = {
  searchParams: Promise<{ error?: string; notice?: string; method?: string }>;
};

export const metadata: Metadata = {
  title: "Sign in",
  alternates: { canonical: "/login" },
  openGraph: {
    ...PUBLIC_OPEN_GRAPH,
    url: "/login",
    title: "Sign in | BSCPLC IPT NotifySystem",
  },
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const configured = getPublicConfig().configured;
  const state = await searchParams;
  return (
    <main className="setup-page">
      <section className="setup-card login-card" aria-labelledby="login-title">
        <BrandLogo />
        <p className="eyebrow">Invitation-only access</p>
        <h1 id="login-title">BSCPLC IPT NotifySystem</h1>
        <p className="muted">Notification system for service renewal</p>
        {!configured ? (
          <div className="notice notice-warning">
            Supabase is not configured for this deployment. <Link href="/setup">Open setup guidance</Link>.
          </div>
        ) : (
          <LoginForm error={state.error} method={state.method} notice={state.notice} />
        )}
      </section>
    </main>
  );
}
