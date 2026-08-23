import Link from "next/link";
import type { ReactElement } from "react";
import { beginSignIn, requestMagicLink, signInWithPassword } from "@/app/login/actions";

type LoginFormProps = {
  error?: string;
  notice?: string;
  method?: string;
  step?: string;
  email?: string;
};

const errorMessages: Record<string, string> = {
  "invalid-input": "Check the information you entered and try again.",
  "invalid-credentials": "The email or password was not accepted.",
  "not-authorized": "Your account is not active. Contact a system administrator.",
  "invalid-link": "This sign-in link is invalid or expired. Request a new one below.",
  "rate-limited": "Too many sign-in attempts were made. Please wait about an hour, then request a new sign-in link.",
  "service-unavailable": "Sign-in is temporarily unavailable. Please try again shortly.",
};

export function LoginForm({ error, notice, method, step, email }: LoginFormProps): ReactElement {
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

      {method === "password" ? (
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
            No password? <Link href="/login?method=link">Use the sign-in link instead</Link>.
          </p>
        </form>
      ) : method === "link" ? (
        <form action={requestMagicLink} className="form-stack">
          <label>
            Work email
            <input
              autoComplete="email"
              name="email"
              placeholder="support.iig@bsccl.com"
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
      ) : step === "password" && email ? (
        <>
          <p className="muted form-help">
            Signing in as <strong>{email}</strong>.{" "}
            <Link href="/login">Not you? Use a different email</Link>.
          </p>
          <form action={signInWithPassword} className="form-stack">
            <input type="hidden" name="step" value="password" />
            <input type="hidden" name="email" value={email} />
            <label>
              Password
              <input autoComplete="current-password" name="password" required type="password" />
            </label>
            <button className="button button-primary" type="submit">
              Sign in
            </button>
          </form>
          <form action={requestMagicLink} className="form-stack">
            <input type="hidden" name="email" value={email} />
            <button className="button button-secondary" type="submit">
              Email me a sign-in link instead
            </button>
          </form>
        </>
      ) : (
        <form action={beginSignIn} className="form-stack">
          <label>
            Work email
            <input
              autoComplete="email"
              name="email"
              placeholder="support.iig@bsccl.com"
              required
              type="email"
            />
          </label>
          <button className="button button-primary" type="submit">
            Continue
          </button>
          <p className="muted form-help">
            We&apos;ll check your account and either send a sign-in link or ask for your password.
          </p>
        </form>
      )}
    </>
  );
}
