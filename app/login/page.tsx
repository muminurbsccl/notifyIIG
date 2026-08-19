import Link from "next/link";
import type { Metadata } from "next";
import { LoginBrandPanel } from "@/components/login-brand-panel";
import { LoginForm } from "@/components/login-form";
import { getPublicConfig } from "@/lib/config";
import { PUBLIC_OPEN_GRAPH } from "@/lib/public-metadata";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    notice?: string;
    method?: string;
    step?: string;
    email?: string;
  }>;
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
    <main className="login-split">
      <LoginBrandPanel />
      <section className="login-form-panel" aria-labelledby="signin-title">
        <h2 id="signin-title">Sign in</h2>
        <p className="muted">Welcome back</p>
        {!configured ? (
          <div className="notice notice-warning">
            Supabase is not configured for this deployment. <Link href="/setup">Open setup guidance</Link>.
          </div>
        ) : (
          <LoginForm
            error={state.error}
            notice={state.notice}
            method={state.method}
            step={state.step}
            email={state.email}
          />
        )}
      </section>
    </main>
  );
}
