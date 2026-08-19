# Login Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tabbed login page with a split-screen layout (brand panel + form panel) and an email-first sign-in flow where the server decides between the password step and a magic link.

**Architecture:** URL-driven server steps — a new `beginSignIn` server action checks `auth_user_has_password(email)` via a `security definer` RPC (service-role only) and redirects to `?step=password&email=…` or `?notice=link-sent`; the existing `signInWithPassword` action gains step-aware error redirects via a hidden `step` form field. `?method=password` and `?method=link` keep rendering today's forms verbatim for compatibility.

**Tech Stack:** Next.js 15 server actions, React 19 server components, `@supabase/supabase-js` (already a dependency — no new deps), Postgres migration for the RPC, vitest + `renderToString` for tests.

## Global Constraints

- Repo: `D:\upstreamnotify` (Windows, PowerShell 7, git on `master`; commit to master is the established workflow; do NOT push unless a task says so).
- Tests: `npx vitest run <file>` for focused runs; `npx vitest run` for the full suite; `npm run typecheck` for type checking.
- No new npm dependencies. `pg` is NOT used by this feature.
- Copy must be reused verbatim from the current code where the spec says so (`errorMessages` map, notices, PKCE callback URL).
- Anti-enumeration is a hard requirement: unknown email and passwordless email MUST produce the identical redirect (`/login?notice=link-sent`).
- The RPC `auth_user_has_password` MUST be executable only by `service_role` (revoke from `public`, `anon`, `authenticated`).
- Existing tests in `tests/login-actions.test.ts` must stay green without edits to their expectations (only the mock setup for `getServerConfig` and `createClient` may be extended).
- Design doc: `docs/superpowers/specs/2026-08-19-login-page-redesign-design.md` (approved).

---

### Task 1: Email-first server actions + migration

**Files:**
- Create: `supabase/migrations/006_auth_user_has_password.sql`
- Modify: `app/login/actions.ts` (add imports, `createServiceRoleClient` helper, `beginSignIn`; rework `signInWithPassword` error destinations)
- Test: `tests/login-actions.test.ts`

**Interfaces:**
- Consumes: `requireEmail`, `requirePassword`, `validatedAppBaseUrl`, `authCallbackUrl` from `@/lib/auth-flow`; `getServerConfig()` from `@/lib/server-config` (returns `supabaseUrl`, `serviceRoleKey`, `appBaseUrl`); `createWritableServerSupabaseClient` from `@/lib/supabase/server`; `isInvalidInput`, `isRateLimited`, `isInvalidCredentials`, `serviceErrorDestination` (module-local helpers, keep as-is).
- Produces:
  - `beginSignIn(formData: FormData): Promise<void>` — server action.
  - `signInWithPassword(formData: FormData): Promise<void>` — now also handles a hidden `step=password` field and hidden `email` field from the step-2 form; error redirects preserve `?step=password&email=<encoded>` when `step` is present.
  - Migration 006 with `public.auth_user_has_password(email text) returns boolean`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/login-actions.test.ts`. Extend the mock setup first (inside the existing `mocks` hoisted object add `rpc: vi.fn()`, `createClient: vi.fn()`; change the `getServerConfig` mock to a hoisted fn):

```ts
const mocks = vi.hoisted(() => ({
  redirect: vi.fn((location: string) => {
    throw new RedirectSignal(location);
  }),
  signInWithOtp: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  createWritableClient: vi.fn(),
  getAuthContext: vi.fn(),
  rpc: vi.fn(),
  createClient: vi.fn(),
  getServerConfig: vi.fn(() => ({
    appBaseUrl: "https://notifyiig.vercel.app",
    supabaseUrl: "https://xyz.supabase.co",
    serviceRoleKey: "svc-key",
  })),
}));
```

Replace the static `vi.mock("@/lib/server-config", ...)` block with:

```ts
vi.mock("@/lib/server-config", () => ({ getServerConfig: mocks.getServerConfig }));
```

Add after the existing `authClient` definition:

```ts
const serviceClient = {
  rpc: mocks.rpc,
};

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
```

Update the `beforeEach` block (append):

```ts
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.createClient.mockReturnValue(serviceClient);
```

Update the import line for actions (append `beginSignIn`):

```ts
const { beginSignIn, requestMagicLink, signInWithPassword } = await import("@/app/login/actions");
```

Append these tests inside the `describe("server login actions", ...)` block:

```ts
  describe("beginSignIn (email-first)", () => {
    it("routes an account with a password to the password step", async () => {
      mocks.rpc.mockResolvedValue({ data: true, error: null });

      await expectRedirect(
        beginSignIn(formData({ email: " Person@Example.COM " })),
        "/login?step=password&email=person%40example.com",
      );

      expect(mocks.createClient).toHaveBeenCalledWith(
        "https://xyz.supabase.co",
        "svc-key",
        { auth: { persistSession: false } },
      );
      expect(mocks.rpc).toHaveBeenCalledWith("auth_user_has_password", {
        email: "person@example.com",
      });
      expect(mocks.signInWithOtp).not.toHaveBeenCalled();
    });

    it("sends a magic link for any account without a password (anti-enumeration)", async () => {
      mocks.rpc.mockResolvedValue({ data: false, error: null });
      mocks.signInWithOtp.mockResolvedValue({ error: null });

      await expectRedirect(
        beginSignIn(formData({ email: "person@example.com" })),
        "/login?notice=link-sent",
      );

      expect(mocks.signInWithOtp).toHaveBeenCalledWith({
        email: "person@example.com",
        options: {
          emailRedirectTo: "https://notifyiig.vercel.app/auth/callback",
          shouldCreateUser: false,
        },
      });
    });

    it("does not reveal whether an unknown email exists", async () => {
      mocks.rpc.mockResolvedValue({ data: false, error: null });
      mocks.signInWithOtp.mockResolvedValue({ error: null });

      await expectRedirect(
        beginSignIn(formData({ email: "unknown@example.com" })),
        "/login?notice=link-sent",
      );
    });

    it("maps invalid email input to a fixed public state", async () => {
      await expectRedirect(
        beginSignIn(formData({ email: "not-an-email" })),
        "/login?error=invalid-input",
      );
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.signInWithOtp).not.toHaveBeenCalled();
    });

    it("maps a magic-link email rate limit to a dedicated state", async () => {
      mocks.rpc.mockResolvedValue({ data: false, error: null });
      mocks.signInWithOtp.mockResolvedValue({
        data: {},
        error: { code: "over_email_send_rate_limit", status: 429, message: "email rate limit exceeded" },
      });

      await expectRedirect(
        beginSignIn(formData({ email: "person@example.com" })),
        "/login?error=rate-limited",
      );
    });

    it("does not reflect an RPC failure and never sends a link", async () => {
      mocks.rpc.mockResolvedValue({ data: null, error: new Error("database connection detail") });

      await expectRedirect(
        beginSignIn(formData({ email: "person@example.com" })),
        "/login?error=service-unavailable",
      );
      expect(mocks.signInWithOtp).not.toHaveBeenCalled();
    });

    it("maps a missing service-role key to service unavailable", async () => {
      mocks.getServerConfig.mockReturnValueOnce({
        appBaseUrl: "https://notifyiig.vercel.app",
        supabaseUrl: "https://xyz.supabase.co",
        serviceRoleKey: null,
      });

      await expectRedirect(
        beginSignIn(formData({ email: "person@example.com" })),
        "/login?error=service-unavailable",
      );
      expect(mocks.createClient).not.toHaveBeenCalled();
    });
  });

  describe("signInWithPassword (password step)", () => {
    it("preserves the step and email on invalid credentials", async () => {
      mocks.signInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: { code: "invalid_credentials", status: 400, message: "provider secret detail" },
      });

      const data = formData({ email: "person@example.com", password: "bad" });
      data.set("step", "password");

      await expectRedirect(
        signInWithPassword(data),
        "/login?error=invalid-credentials&step=password&email=person%40example.com",
      );
    });

    it("preserves the step and email on a rate limit", async () => {
      mocks.signInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: { code: "over_request_rate_limit", status: 429, message: "too many requests" },
      });

      const data = formData({ email: "person@example.com", password: "bad" });
      data.set("step", "password");

      await expectRedirect(
        signInWithPassword(data),
        "/login?error=rate-limited&step=password&email=person%40example.com",
      );
    });

    it("redirects to the dashboard on success from the step form", async () => {
      mocks.signInWithPassword.mockResolvedValue({
        data: { user: { id: "user-1" }, session: { access_token: "hidden" } },
        error: null,
      });
      mocks.getAuthContext.mockResolvedValue({
        user: { id: "user-1" },
        profile: { id: "user-1", active: true, role: "admin" },
        supabase: authClient,
      });

      const data = passwordFormData("correct");
      data.set("step", "password");

      await expectRedirect(signInWithPassword(data), "/dashboard");
    });

    it("clears a step-form session that has no authorized profile", async () => {
      mocks.signInWithPassword.mockResolvedValue({
        data: { user: { id: "user-1" }, session: { access_token: "hidden" } },
        error: null,
      });
      mocks.getAuthContext.mockResolvedValue(null);

      const data = passwordFormData("correct");
      data.set("step", "password");

      await expectRedirect(
        signInWithPassword(data),
        "/login?error=not-authorized&step=password&email=person%40example.com",
      );
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/login-actions.test.ts`
Expected: the `beginSignIn` tests FAIL (function not exported) and the step tests FAIL (no `step` handling). All pre-existing tests still PASS (the mock changes are additive).

- [ ] **Step 3: Create the migration**

Create `supabase/migrations/006_auth_user_has_password.sql` with exactly:

```sql
-- Email-first sign-in: lets the server decide between the password step and a
-- magic link without exposing which accounts have passwords (service_role only).
create or replace function public.auth_user_has_password(email text)
returns boolean
language sql
security definer
set search_path = auth, pg_temp
as $$
  select exists (
    select 1 from auth.users u
    where u.email = $1 and coalesce(u.encrypted_password, '') <> ''
  );
$$;

revoke all on function public.auth_user_has_password(text) from public, anon, authenticated;
grant execute on function public.auth_user_has_password(text) to service_role;
```

- [ ] **Step 4: Implement the actions**

In `app/login/actions.ts`:

1. Add imports at the top:

```ts
import { createClient } from "@supabase/supabase-js";
import { getServerConfig } from "@/lib/server-config";
```

2. Add the service-role client helper after `serviceErrorDestination`:

```ts
function createServiceRoleClient() {
  const { supabaseUrl, serviceRoleKey } = getServerConfig();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("service configuration is missing");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
```

3. Add `beginSignIn` after `requestMagicLink`:

```ts
export async function beginSignIn(formData: FormData): Promise<void> {
  let destination: string;
  try {
    const email = requireEmail(formData.get("email"));
    const { data, error } = await createServiceRoleClient().rpc(
      "auth_user_has_password",
      { email },
    );
    if (error) throw error;

    if (data === true) {
      destination = `/login?step=password&email=${encodeURIComponent(email)}`;
    } else {
      // Passwordless or unknown email: identical path (anti-enumeration).
      const baseUrl = validatedAppBaseUrl(getServerConfig().appBaseUrl ?? undefined);
      const supabase = await createWritableServerSupabaseClient();
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: authCallbackUrl(baseUrl),
          shouldCreateUser: false,
        },
      });
      destination = otpError
        ? isRateLimited(otpError)
          ? "/login?error=rate-limited"
          : serviceErrorDestination("")
        : "/login?notice=link-sent";
    }
  } catch (cause) {
    destination = isInvalidInput(cause)
      ? "/login?error=invalid-input"
      : isRateLimited(cause)
        ? "/login?error=rate-limited"
        : serviceErrorDestination("");
  }
  redirect(destination);
}
```

4. Rework `signInWithPassword` — replace the body with:

```ts
export async function signInWithPassword(formData: FormData): Promise<void> {
  const step = formData.get("step") === "password";
  const rawEmail = formData.get("email");
  const emailParam = step
    ? `&step=password&email=${encodeURIComponent(String(rawEmail ?? ""))}`
    : "";
  const methodParam = step ? "" : "&method=password";
  const errorDestination = (key: string): string =>
    `/login?error=${key}${step ? emailParam : methodParam}`;

  let destination: string;
  try {
    const email = requireEmail(rawEmail);
    const password = requirePassword(formData.get("password"));
    const supabase = await createWritableServerSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      destination = isInvalidCredentials(error)
        ? errorDestination("invalid-credentials")
        : isRateLimited(error)
          ? errorDestination("rate-limited")
          : errorDestination("service-unavailable");
    } else {
      const context = await getAuthContext(supabase);
      if (context) {
        destination = "/dashboard";
      } else {
        const { error: signOutError } = await supabase.auth.signOut();
        destination = signOutError
          ? errorDestination("service-unavailable")
          : `/login?error=not-authorized${step ? emailParam : ""}`;
      }
    }
  } catch (cause) {
    destination = isInvalidInput(cause)
      ? `/login?error=invalid-input${step ? emailParam : "&method=password"}`
      : errorDestination("service-unavailable");
  }
  redirect(destination);
}
```

Verification against existing tests: without `step`, `methodParam = "&method=password"` and `errorDestination` produces exactly `/login?error=invalid-credentials&method=password`, `/login?error=rate-limited&method=password`, `/login?error=service-unavailable&method=password`; `not-authorized` stays `/login?error=not-authorized`; invalid-input stays `/login?error=invalid-input&method=password` — all existing expectations hold.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/login-actions.test.ts`
Expected: ALL tests pass (existing 14 + new 11).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/006_auth_user_has_password.sql app/login/actions.ts tests/login-actions.test.ts
git commit -m "feat(auth): email-first beginSignIn with auth_user_has_password RPC"
```

---

### Task 2: LoginForm four modes

**Files:**
- Modify: `components/login-form.tsx` (full rework)
- Test: `tests/login-form.test.ts` (new)

**Interfaces:**
- Consumes: `beginSignIn`, `signInWithPassword`, `requestMagicLink` from `@/app/login/actions` (Task 1); `Link` from `next/link`.
- Produces: `LoginForm` with props `{ error?: string; notice?: string; method?: string; step?: string; email?: string }` rendering exactly one of four modes (step-1 email form, step-2 password form, `method=password` combined form, `method=link` link form), with shared notice/error banners above. `app/login/page.tsx` (Task 3) consumes this.

- [ ] **Step 1: Write the failing tests**

Create `tests/login-form.test.ts` with exactly:

```ts
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/login-form";

vi.mock("server-only", () => ({}));
vi.mock("@/app/login/actions", () => ({
  beginSignIn: vi.fn(),
  signInWithPassword: vi.fn(),
  requestMagicLink: vi.fn(),
}));

describe("LoginForm", () => {
  it("renders only the email field on step 1 (no tabs, no password field)", () => {
    const html = renderToString(createElement(LoginForm, {}));
    expect(html).toContain('name="email"');
    expect(html).not.toContain('name="password"');
    expect(html).not.toContain("login-modes");
    expect(html).toContain("Continue");
  });

  it("renders the password step with the email, different-email link, and link escape", () => {
    const html = renderToString(
      createElement(LoginForm, { step: "password", email: "person@example.com" }),
    );
    expect(html).toContain('name="step"');
    expect(html).toContain('value="password"');
    expect(html).toContain('value="person@example.com"');
    expect(html).toContain("person@example.com");
    expect(html).toContain('name="password"');
    expect(html).toContain("Not you?");
    expect(html).toContain("Email me a sign-in link instead");
  });

  it("renders the combined email + password form for method=password", () => {
    const html = renderToString(createElement(LoginForm, { method: "password" }));
    expect(html).toContain('name="email"');
    expect(html).toContain('name="password"');
    expect(html).toContain('href="/login?method=link"');
    expect(html).toContain("No password?");
  });

  it("renders the magic-link form for method=link", () => {
    const html = renderToString(createElement(LoginForm, { method: "link" }));
    expect(html).toContain('name="email"');
    expect(html).not.toContain('name="password"');
    expect(html).toContain("Email me a sign-in link");
  });

  it("renders the link-sent success notice", () => {
    const html = renderToString(createElement(LoginForm, { notice: "link-sent" }));
    expect(html).toContain("notice-success");
    expect(html).toContain("sign-in link is on its way");
  });

  it("renders the invalid-credentials warning", () => {
    const html = renderToString(createElement(LoginForm, { error: "invalid-credentials" }));
    expect(html).toContain("notice-warning");
    expect(html).toContain("email or password was not accepted");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/login-form.test.ts`
Expected: FAIL (old `LoginForm` renders tabs, not these structures).

- [ ] **Step 3: Implement the four-mode LoginForm**

Replace the entire contents of `components/login-form.tsx` with:

```tsx
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
              placeholder="you@bscplc.com.bd"
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/login-form.test.ts`
Expected: 6/6 PASS.

- [ ] **Step 5: Commit**

```bash
git add components/login-form.tsx tests/login-form.test.ts
git commit -m "feat(auth): four-mode LoginForm for email-first sign-in"
```

---

### Task 3: Split-screen page layout

**Files:**
- Create: `components/login-brand-panel.tsx`
- Modify: `app/login/page.tsx` (full rework), `app/globals.css` (append `.login-*` styles)
- Test: none (typecheck + Task 4 E2E cover it)

**Interfaces:**
- Consumes: `LoginForm` (Task 2, props `{ error?, notice?, method?, step?, email? }`); `BrandLogo` from `@/components/brand-logo`; `getPublicConfig` from `@/lib/config`.
- Produces: `LoginBrandPanel` (static server component, no props); updated `LoginPage` with `searchParams: Promise<{ error?: string; notice?: string; method?: string; step?: string; email?: string }>`; `.login-*` CSS classes.

- [ ] **Step 1: Read the current CSS conventions**

Read `app/globals.css` and note the existing `setup-page`, `setup-card`, `.muted`, `.eyebrow`, `h1` typography rules so the new `.login-*` rules match the visual language (font sizes, margins, radii). Do not modify those existing rules.

- [ ] **Step 2: Create the brand panel component**

Create `components/login-brand-panel.tsx` with:

```tsx
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
```

- [ ] **Step 3: Rework the page**

Replace the contents of `app/login/page.tsx` with:

```tsx
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
```

- [ ] **Step 4: Append the CSS**

Append to `app/globals.css`:

```css
/* Login: split-screen layout */
.login-split {
  min-height: 100dvh;
  display: grid;
  grid-template-columns: minmax(320px, 45%) 1fr;
}

.login-brand {
  background: linear-gradient(150deg, #0f172a, #1e3a8a 55%, #1d4ed8);
  color: #fff;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 48px;
}

.login-brand .brand-logo-image {
  max-width: 160px;
  height: auto;
}

.login-brand h1 {
  margin-top: 28px;
  font-size: 1.75rem;
  line-height: 1.25;
  color: #fff;
}

.login-brand-tagline {
  margin-top: 8px;
  color: rgba(255, 255, 255, 0.75);
}

.login-brand-footer {
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.85rem;
}

.login-form-panel {
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: 100%;
  max-width: 440px;
  margin: 0 auto;
  padding: 48px 24px;
}

.login-form-panel h2 {
  font-size: 1.5rem;
  margin-bottom: 4px;
}

.login-form-panel > .muted {
  margin-bottom: 20px;
}

@media (max-width: 900px) {
  .login-split {
    grid-template-columns: 1fr;
  }

  .login-brand {
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    gap: 16px;
    padding: 20px 24px;
  }

  .login-brand h1 {
    margin-top: 0;
    font-size: 1.1rem;
  }

  .login-brand .brand-logo-image {
    max-width: 56px;
  }

  .login-brand-tagline,
  .login-brand-footer {
    display: none;
  }

  .login-form-panel {
    padding: 32px 24px;
  }
}
```

(Adjust values only if they conflict with an existing rule you found in Step 1 — e.g., a global `h1` rule; keep the structure.)

- [ ] **Step 5: Verify with typecheck**

Run: `npm run typecheck`
Expected: clean, exit 0.

- [ ] **Step 6: Commit**

```bash
git add components/login-brand-panel.tsx app/login/page.tsx app/globals.css
git commit -m "feat(auth): split-screen login page with brand panel"
```

---

### Task 4: Production apply, full verification, and live E2E

**Files:**
- Modify: none (verification and deployment task)
- Run: `scripts/apply-sql.mjs` against production, `npx vitest run`, `npm run typecheck`, git push, CDP E2E

**Interfaces:**
- Consumes: migration 006 (Task 1), all implementation from Tasks 1–3. Uses `DATABASE_URL` from `.env.local` (prefix length 13 when extracting) and operator credentials for the E2E.

- [ ] **Step 1: Run the full suite and typecheck**

Run: `npx vitest run`
Expected: all tests pass (previous 288 + new: 11 actions + 6 form = 305).
Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 2: Apply migration 006 to production**

Run (from repo root, PowerShell):
```powershell
node scripts/apply-sql.mjs supabase/migrations/006_auth_user_has_password.sql
```
(If `DATABASE_URL is not set`, load it from `.env.local` first — the script requires the env var.)

Expected: `OK ... All files applied.`

Verify the function exists and is locked down (run via the same apply mechanism or a quick node `pg` script):
```sql
select proname, proacl is null as default_acl
from pg_proc
where proname = 'auth_user_has_password';
```
Expected: one row; `default_acl` false (grants were changed from default).

- [ ] **Step 3: Push and wait for the deploy**

```bash
git push origin master
```
Then poll `https://notifyiig.vercel.app/` until it returns 200 (redirect to `/login` is fine).

- [ ] **Step 4: CDP E2E of the new flow**

Using the headless-Chrome CDP harness pattern from `C:\Users\Mumin\AppData\Local\Temp\opencode\cdp-notice-visual.mjs` (password login + `Runtime.evaluate` + page text extraction), verify against the deployed site:

1. Load `https://notifyiig.vercel.app/login` → page shows exactly ONE input (`name="email"`), NO `name="password"`, no `login-modes` nav, and the brand panel text "Bangladesh Submarine Cable PLC".
2. Fill the operator email `muminurbsccl@gmail.com` and submit → lands on `?step=password&email=…` → password field present, email shown.
3. Fill the temp password and submit → lands on `/dashboard` (authed) with zero console errors.
4. New session (no profile): load `/login`, enter a non-existent email, submit → `?notice=link-sent` with the success banner (anti-enumeration visible).
5. Load `/login?method=password` → combined email+password form renders.
6. Capture console errors after each step; any `Runtime.exceptionThrown` or `Log.entryAdded` error is a failure.

- [ ] **Step 5: Clean up the E2E session**

Delete the sessions/refresh tokens created by the E2E (they were created in the last ~20 minutes, excluding the two real sessions `a0051cb9-57f2-4bb0-800f-e87103531175` and `4f8e0362-34dc-46a1-a048-4ab238bc879d`):
```sql
DELETE FROM auth.refresh_tokens
WHERE session_id IN (
  SELECT id FROM auth.sessions
  WHERE id NOT IN ('a0051cb9-57f2-4bb0-800f-e87103531175', '4f8e0362-34dc-46a1-a048-4ab238bc879d')
    AND created_at > now() - interval '30 minutes'
);
DELETE FROM auth.sessions
WHERE id NOT IN ('a0051cb9-57f2-4bb0-800f-e87103531175', '4f8e0362-34dc-46a1-a048-4ab238bc879d')
  AND created_at > now() - interval '30 minutes';
```

- [ ] **Step 6: Final whole-branch review**

Generate a review package (`git diff -U10 <merge-base>..HEAD` into `.superpowers/sdd/2026-08-19-login-page-redesign/final-review-package.txt`) and dispatch a reviewer against the spec; fix or defer its findings per severity; record deferred items in the progress ledger.

- [ ] **Step 7: Update the ledger**

Append a completion line to `.superpowers/sdd/2026-08-19-login-page-redesign/progress.md` with commits, test count, E2E outcome, and deferred findings.