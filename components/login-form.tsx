"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { AuthChangeEvent } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type Mode = "link" | "password";

function readHashError() {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const code = params.get("error_code") ?? params.get("error");
  const description = params.get("error_description");
  const email = params.get("email");
  return { code, description, email };
}

function clearHash() {
  if (typeof window !== "undefined") {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("link");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();

    const hashError = readHashError();
    if (hashError && (hashError.code || hashError.description)) {
      if (hashError.email) setEmail(hashError.email);
      if (hashError.code === "otp_expired" || /expired/i.test(hashError.description ?? "")) {
        setNotice(
          "This sign-in link has expired or was already used. Request a new one below — it takes a few seconds."
        );
      } else {
        setNotice(
          hashError.description ||
            "The sign-in link was not accepted. Request a new one below and try again."
        );
      }
      clearHash();
    }

    const {
      data: { subscription },
    } =     supabase.auth.onAuthStateChange((event: AuthChangeEvent) => {
      if (event === "SIGNED_IN") {
        router.push("/dashboard");
        router.refresh();
      }
    });
    return () => subscription.unsubscribe();
  }, [router]);

  async function handleLinkSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSubmitting(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const redirectTo = `${window.location.origin}/login`;
      const { error: authError } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });
      if (authError) throw authError;
      setLinkSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send the sign-in link");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSubmitting(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const result = await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      router.push("/dashboard");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed");
    } finally {
      setSubmitting(false);
    }
  }

  function resend() {
    setLinkSent(false);
  }

  return (
    <>
      {searchParams.get("error") === "not-authorized" && (
        <p className="notice notice-warning">Your account is not active. Contact a system administrator.</p>
      )}
      {notice && (
        <p className="notice notice-warning" role="alert">
          {notice}
        </p>
      )}

      <div className="login-modes" role="group" aria-label="Sign-in method">
        <button
          aria-pressed={mode === "link"}
          className={mode === "link" ? "button button-primary" : "button button-secondary"}
          onClick={() => {
            setMode("link");
            setLinkSent(false);
            setError("");
          }}
          type="button"
        >
          Sign-in link
        </button>
        <button
          aria-pressed={mode === "password"}
          className={mode === "password" ? "button button-primary" : "button button-secondary"}
          onClick={() => {
            setMode("password");
            setError("");
          }}
          type="button"
        >
          Password
        </button>
      </div>

      {mode === "link" ? (
        linkSent ? (
          <div aria-live="polite">
            <p className="notice notice-success">
              Sign-in link sent to <strong>{email}</strong>. Check your inbox and click the link to
              sign in.
            </p>
            <div className="stack-gap-sm">
              <button className="button button-secondary" onClick={resend} type="button">
                Didn&apos;t receive it? Send again
              </button>
              <button className="button button-secondary" onClick={() => setEmail("")} type="button">
                Use a different email
              </button>
            </div>
          </div>
        ) : (
          <form className="form-stack" onSubmit={handleLinkSubmit}>
            <label>
              Work email
              <input
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@bscplc.com.bd"
                required
                type="email"
                value={email}
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="button button-primary" disabled={submitting} type="submit">
              {submitting ? "Sending…" : "Email me a sign-in link"}
            </button>
            <p className="muted form-help">
              We&apos;ll email you a one-time link. It expires after one hour.
            </p>
          </form>
        )
      ) : (
        <form className="form-stack" onSubmit={handlePasswordSubmit}>
          <label>
            Work email
            <input
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button button-primary" disabled={submitting} type="submit">
            {submitting ? "Signing in…" : "Sign in"}
          </button>
          <p className="muted form-help">
            No password? <button className="link-button" onClick={() => setMode("link")} type="button">Use the sign-in link instead</button>.
          </p>
        </form>
      )}
    </>
  );
}
