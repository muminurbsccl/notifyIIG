import Link from "next/link";
import type { ReactElement } from "react";
import { requestMagicLink, signInWithPassword } from "@/app/login/actions";

type LoginFormProps = {
  error?: string;
  notice?: string;
  method?: string;
};

const errorMessages: Record<string, string> = {
  "invalid-input": "Check the information you entered and try again.",
  "invalid-credentials": "The email or password was not accepted.",
  "not-authorized": "Your account is not active. Contact a system administrator.",
  "invalid-link": "This sign-in link is invalid or expired. Request a new one below.",
  "service-unavailable": "Sign-in is temporarily unavailable. Please try again shortly.",
};

export function LoginForm({ error, notice, method }: LoginFormProps): ReactElement {
  const passwordMode = method === "password";
  const errorMessage = error ? errorMessages[error] : undefined;

  return (
    <>
      {notice === "link-sent" && (
        <p className="notice notice-success" role="status">
          If the account is eligible, a sign-in link is on its way. Check your inbox.
        </p>
      )}
      {errorMessage && (
        <p className="notice notice-warning" role="alert">
          {errorMessage}
        </p>
      )}

      <nav className="login-modes" aria-label="Sign-in method">
        <Link
          aria-current={!passwordMode ? "page" : undefined}
          className={!passwordMode ? "button button-primary" : "button button-secondary"}
          href="/login"
        >
          Sign-in link
        </Link>
        <Link
          aria-current={passwordMode ? "page" : undefined}
          className={passwordMode ? "button button-primary" : "button button-secondary"}
          href="/login?method=password"
        >
          Password
        </Link>
      </nav>

      {passwordMode ? (
        <form action={signInWithPassword} className="form-stack">
          <label>
            Work email
            <input autoComplete="email" name="email" required type="email" />
          </label>
          <label>
            Password
            <input autoComplete="current-password" name="password" required type="password" />
          </label>
          <button className="button button-primary" type="submit">
            Sign in
          </button>
          <p className="muted form-help">
            No password? <Link href="/login">Use the sign-in link instead</Link>.
          </p>
        </form>
      ) : (
        <form action={requestMagicLink} className="form-stack">
          <label>
            Work email
            <input
              autoComplete="email"
              name="email"
              placeholder="you@bscplc.com.bd"
              required
              type="email"
            />
          </label>
          <button className="button button-primary" type="submit">
            Email me a sign-in link
          </button>
          <p className="muted form-help">
            We&apos;ll email you a one-time link. It expires after one hour.
          </p>
        </form>
      )}
    </>
  );
}
