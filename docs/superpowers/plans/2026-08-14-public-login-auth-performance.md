# Public Login, Authentication, and Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a correctly branded, server-authenticated production login page with safe PKCE callbacks and Lighthouse 100 targets on mobile and desktop.

**Architecture:** Keep authentication policy in pure helpers, framework and cookie handling in thin Next.js server boundaries, and the login page server-rendered. Replace the padded logo with one local JPEG and add App Router metadata assets without introducing client JavaScript.

**Tech Stack:** Next.js 15 App Router, React 19 Server Components/Actions, Supabase SSR/JS, TypeScript, Vitest, CSS, Lighthouse.

## Global Constraints

- Production base URL is exactly `https://notifyiig.vercel.app`.
- Production callback is exactly `https://notifyiig.vercel.app/auth/callback`.
- Magic-link redirects come from validated server-side `APP_BASE_URL`, never browser origin.
- Magic-link requests set `shouldCreateUser: false`; registration remains unavailable.
- Callback destinations must be relative internal paths.
- Authentication responses must not expose provider messages, tokens, codes, or account existence.
- The official logo source is a tightly cropped, white-background JPEG at 320 pixels wide.
- `/login` is indexable; protected application paths are disallowed in robots directives.
- Preserve unrelated changes and do not commit Lighthouse reports or secrets.

---

## File structure

- Create `lib/auth-flow.ts`: pure URL, destination, input, and safe-state policy.
- Create `app/login/actions.ts`: password and magic-link server actions.
- Create `app/auth/callback/route.ts`: PKCE exchange and authorized redirect.
- Replace `components/login-form.tsx`: server-rendered forms and notices only.
- Modify `lib/supabase/server.ts`: explicit cookie-writing client support.
- Modify `middleware.ts`: public callback/metadata paths and preserved session cookies.
- Modify `app/login/page.tsx`: async search params and page metadata.
- Modify `app/layout.tsx`: global metadata base, icons, and social defaults.
- Create `app/robots.ts` and `app/icon.png`.
- Create `public/brand/bscplc-logo.jpg`; modify `components/brand-logo.tsx` and `app/globals.css`.
- Add focused tests under `tests/auth-flow.test.ts`, `tests/login-actions.test.ts`, `tests/auth-callback.test.ts`, and `tests/public-metadata.test.ts`.

### Task 1: Pure authentication policy

**Files:**
- Create: `lib/auth-flow.ts`
- Test: `tests/auth-flow.test.ts`

**Interfaces:**
- Produces: `safeInternalDestination(value, fallback)`, `validatedAppBaseUrl(value)`, `authCallbackUrl(baseUrl)`, `requireEmail(value)`, `requirePassword(value)`, and `LoginResultState`.
- Consumes: no framework state or environment globals.

- [ ] **Step 1: Write failing table-driven policy tests**

```ts
expect(safeInternalDestination("/dashboard?tab=due")).toBe("/dashboard?tab=due");
for (const value of ["https://evil.example", "//evil.example", "\\evil.example", "javascript:alert(1)"])
  expect(safeInternalDestination(value)).toBe("/dashboard");
expect(validatedAppBaseUrl("https://notifyiig.vercel.app").origin)
  .toBe("https://notifyiig.vercel.app");
expect(() => validatedAppBaseUrl("http://evil.example")).toThrow("APP_BASE_URL");
expect(authCallbackUrl(new URL("https://notifyiig.vercel.app")))
  .toBe("https://notifyiig.vercel.app/auth/callback");
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npx vitest run tests/auth-flow.test.ts`

Expected: FAIL because `lib/auth-flow.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure policy**

```ts
export type LoginResultState =
  | "link-sent" | "invalid-input" | "invalid-credentials"
  | "not-authorized" | "invalid-link" | "service-unavailable";

export function safeInternalDestination(value: string | null, fallback = "/dashboard"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  const parsed = new URL(value, "https://internal.invalid");
  return parsed.origin === "https://internal.invalid" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : fallback;
}

export function validatedAppBaseUrl(value: string | undefined): URL {
  if (!value) throw new Error("APP_BASE_URL is required");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("APP_BASE_URL must be a valid URL"); }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("APP_BASE_URL must use HTTPS");
  return url;
}

export function authCallbackUrl(baseUrl: URL): string {
  return new URL("/auth/callback", baseUrl).toString();
}

export function requireEmail(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))
    throw new Error("invalid-input");
  return value.trim().toLowerCase();
}

export function requirePassword(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("invalid-input");
  return value;
}
```

- [ ] **Step 4: Run the policy tests and confirm GREEN**

Run: `npx vitest run tests/auth-flow.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the policy unit**

```powershell
git add lib/auth-flow.ts tests/auth-flow.test.ts
git commit -m "feat: add server auth flow policy"
```

### Task 2: Cookie-writing Supabase boundary and server login actions

**Files:**
- Modify: `lib/supabase/server.ts`
- Create: `app/login/actions.ts`
- Create: `tests/login-actions.test.ts`
- Modify: `lib/auth.ts`

**Interfaces:**
- Consumes: Task 1 policy helpers and existing `getAuthContext` profile rules.
- Produces: `signInWithPassword(formData: FormData): Promise<void>` and `requestMagicLink(formData: FormData): Promise<void>`.

- [ ] **Step 1: Write failing action tests with a focused auth-client fake**

```ts
it("requests an invitation-only link for the server callback", async () => {
  await requestMagicLink(formData({ email: "person@example.com" }));
  expect(signInWithOtp).toHaveBeenCalledWith({
    email: "person@example.com",
    options: {
      emailRedirectTo: "https://notifyiig.vercel.app/auth/callback",
      shouldCreateUser: false,
    },
  });
});

it("never reflects a provider password error", async () => {
  signInWithPasswordMock.mockResolvedValue({ error: new Error("provider secret detail") });
  await expectActionRedirect(signInWithPassword(formData({ email: "a@b.com", password: "bad" })),
    "/login?error=invalid-credentials&method=password");
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npx vitest run tests/login-actions.test.ts`

Expected: FAIL because actions do not exist.

- [ ] **Step 3: Add an explicit cookie-writing server client path**

Keep the existing read-only Server Component client, and add a boundary whose
`setAll` does not swallow cookie failures in actions. Inject the client into an
optional `getAuthContext(supabase)` parameter so a newly established session is
authorized through the same client.

Preserve the existing `getUser`, profile query, active check, and `APP_ROLES`
validation exactly; change only the signature to accept an optional initialized
server client. Provider errors continue through `AuthError` rather than being
converted to missing sessions.

- [ ] **Step 4: Implement actions with redirect outside catch blocks**

```ts
export async function requestMagicLink(formData: FormData): Promise<void> {
  const email = requireEmail(formData.get("email"));
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: authCallbackUrl(validatedAppBaseUrl(getServerConfig().appBaseUrl)),
      shouldCreateUser: false,
    },
  });
  if (error) redirect("/login?error=service-unavailable");
  redirect("/login?notice=link-sent");
}
```

Password success must call the shared active-profile/role check; an unauthorized
session is signed out before redirecting to `not-authorized`. Catch input-policy
errors and redirect to `invalid-input`; map invalid password credentials to
`invalid-credentials` and provider availability failures to
`service-unavailable`. Keep every `redirect()` call outside the `try` block that
maps ordinary errors so Next.js redirect control flow is never swallowed.

- [ ] **Step 5: Run action and existing auth tests**

Run: `npx vitest run tests/login-actions.test.ts tests/auth-runtime.test.ts tests/auth-boundaries.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit server authentication actions**

```powershell
git add lib/supabase/server.ts lib/auth.ts app/login/actions.ts tests/login-actions.test.ts
git commit -m "feat: move login authentication server-side"
```

### Task 3: PKCE callback and middleware routing

**Files:**
- Create: `app/auth/callback/route.ts`
- Modify: `middleware.ts`
- Test: `tests/auth-callback.test.ts`
- Modify: `tests/auth-boundaries.test.ts`

**Interfaces:**
- Consumes: Task 1 safe destination and Task 2 shared authorization/client boundary.
- Produces: `GET(request: NextRequest): Promise<NextResponse>`.

- [ ] **Step 1: Write failing callback and public-path tests**

```ts
it("exchanges a code and preserves response cookies", async () => {
  const response = await GET(new NextRequest("https://notifyiig.vercel.app/auth/callback?code=abc&next=/dashboard"));
  expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
  expect(response.headers.get("location")).toBe("https://notifyiig.vercel.app/dashboard");
  expect(response.cookies.getAll()).not.toHaveLength(0);
});

it("rejects external next destinations", async () => {
  const response = await GET(new NextRequest("https://notifyiig.vercel.app/auth/callback?code=abc&next=//evil.example"));
  expect(response.headers.get("location")).toBe("https://notifyiig.vercel.app/dashboard");
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npx vitest run tests/auth-callback.test.ts tests/auth-boundaries.test.ts`

Expected: FAIL for missing callback route/public-path behavior.

- [ ] **Step 3: Implement callback cookie propagation and safe failures**

Exchange the code, authorize the active profile, copy every Supabase cookie to
the final `NextResponse.redirect`, and map failures only to `invalid-link`,
`not-authorized`, or `service-unavailable`.

- [ ] **Step 4: Make callback and metadata routes public**

Update middleware public-path logic for `/auth/callback`, `/robots.txt`, and App
Router icon paths without weakening protected application/API checks.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run: `npx vitest run tests/auth-callback.test.ts tests/auth-boundaries.test.ts tests/auth-runtime.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit callback behavior**

```powershell
git add app/auth/callback/route.ts middleware.ts tests/auth-callback.test.ts tests/auth-boundaries.test.ts
git commit -m "feat: add production PKCE callback"
```

### Task 4: Server-rendered login interface

**Files:**
- Replace: `components/login-form.tsx`
- Modify: `app/login/page.tsx`
- Modify: `app/globals.css`
- Test: `tests/public-metadata.test.ts`
- Delete if unused: `lib/supabase/browser.ts`

**Interfaces:**
- Consumes: Task 2 actions and safe URL states.
- Produces: an accessible server-rendered `/login` without Supabase browser code.

- [ ] **Step 1: Add source-level/rendering assertions that fail on client auth**

```ts
expect(loginFormSource).not.toContain('"use client"');
expect(loginFormSource).not.toContain("createBrowserSupabaseClient");
expect(loginFormSource).toContain("requestMagicLink");
expect(loginFormSource).toContain("signInWithPassword");
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npx vitest run tests/public-metadata.test.ts`

Expected: FAIL against the current client form.

- [ ] **Step 3: Render both sign-in methods as server forms**

Use labeled email/password fields, action-bound forms, generic notice/error copy,
and `searchParams: Promise<{ error?: string; notice?: string; method?: string }>`.
Do not echo submitted email addresses or provider error text.

- [ ] **Step 4: Remove obsolete browser auth and client-only CSS**

Delete `lib/supabase/browser.ts` only after confirming no imports remain. Remove
state-toggle CSS only when no consumer remains.

- [ ] **Step 5: Run focused tests, typecheck, and build**

Run: `npx vitest run tests/public-metadata.test.ts tests/auth-callback.test.ts && npm run typecheck && npm run build`

Expected: all commands PASS.

- [ ] **Step 6: Commit the server-rendered login**

```powershell
git add app/login/page.tsx components/login-form.tsx app/globals.css lib/supabase/browser.ts tests/public-metadata.test.ts
git commit -m "perf: server-render the login flow"
```

### Task 5: Official JPEG branding

**Files:**
- Create: `public/brand/bscplc-logo.jpg`
- Modify: `components/brand-logo.tsx`
- Modify: `app/globals.css`
- Modify: `tests/foundation.test.ts`
- Delete: `public/brand/bscplc-logo.webp`

**Interfaces:**
- Preserves: `BrandLogo({ compact?: boolean }): ReactElement`.

- [ ] **Step 1: Change the foundation test to require the approved JPEG**

Assert the file exists, begins with a JPEG signature, is 320 pixels wide, the
component references it with correct intrinsic dimensions, and duplicate
visible `BSCPLC` copy is absent.

- [ ] **Step 2: Run the test and confirm RED**

Run: `npx vitest run tests/foundation.test.ts`

Expected: FAIL because the JPEG does not exist.

- [ ] **Step 3: Generate the asset from the approved local official source**

Crop to non-transparent content bounds, flatten onto pure white, resize to 320
pixels wide with proportional height, and export a quality-optimized JPEG. Do
not upscale or fetch a runtime remote image.

- [ ] **Step 4: Update component dimensions and responsive CSS**

Render the image alone inside `.brand-lockup`; retain accessible alt text and
full/compact sizing without layout shift.

- [ ] **Step 5: Run branding test and production build**

Run: `npx vitest run tests/foundation.test.ts && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit branding**

```powershell
git add public/brand/bscplc-logo.jpg public/brand/bscplc-logo.webp components/brand-logo.tsx app/globals.css tests/foundation.test.ts
git commit -m "fix: resize official BSCPLC branding"
```

### Task 6: Metadata, robots, and icon

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/login/page.tsx`
- Create: `app/robots.ts`
- Create: `app/icon.png`
- Modify: `tests/public-metadata.test.ts`

**Interfaces:**
- Produces: canonical/indexable `/login`, valid robots response, and valid icon route.

- [ ] **Step 1: Write failing metadata-policy assertions**

```ts
expect(layoutSource).toContain("metadataBase");
expect(loginSource).toContain('canonical: "/login"');
expect(robotsSource).toContain('allow: "/login"');
expect(robotsSource).toContain('disallow: ["/dashboard"');
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npx vitest run tests/public-metadata.test.ts`

Expected: FAIL for missing files/metadata.

- [ ] **Step 3: Implement typed Next.js metadata and robots**

Set `metadataBase` to the production origin, preserve title/description, add
Open Graph/Twitter/icon metadata, and provide page-specific canonical metadata.
Return a valid `MetadataRoute.Robots` object that allows public entry assets and
disallows protected application paths.

- [ ] **Step 4: Add an official-brand icon asset**

Generate a legible square icon from the official mark without embedding private
or environment data.

- [ ] **Step 5: Run focused and full static gates**

Run: `npx vitest run tests/public-metadata.test.ts tests/foundation.test.ts && npm run typecheck && npm run lint && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit public metadata**

```powershell
git add app/layout.tsx app/login/page.tsx app/robots.ts app/icon.png tests/public-metadata.test.ts
git commit -m "feat: add public login metadata"
```

### Task 7: Production authentication and Lighthouse gate

**Files:**
- Modify: `README.md`
- Local-only output: Lighthouse HTML/JSON reports outside the repository.

**Interfaces:**
- Consumes: deployed Tasks 1–6 and hosted Supabase Auth settings.
- Produces: recorded verification evidence; no application interface.

- [ ] **Step 1: Document exact hosted Auth settings and checks**

Add the production Site URL, callback URL, local callback policy, password test,
magic-link test, robots/icon checks, and Lighthouse commands to the runbook.

- [ ] **Step 2: Run the complete repository gate**

Run: `npm test -- --run && npm run typecheck && npm run lint && npm run build`

Expected: all commands PASS.

- [ ] **Step 3: Commit the runbook**

```powershell
git add README.md
git commit -m "docs: add production auth verification"
```

- [ ] **Step 4: Deploy and configure Supabase Auth**

Push only after normal review. In Supabase, set the production Site URL and
callback allow-list exactly as specified. Redeploy if environment values change.

- [ ] **Step 5: Verify production routes and authentication**

Run safe HTTP checks for `/login`, `/robots.txt`, icon/favicon, unauthenticated
`/dashboard`, and callback-without-code. Then verify one password login and one
fresh production magic link with an approved account.

- [ ] **Step 6: Run repeated mobile and desktop Lighthouse audits**

```powershell
npx --yes lighthouse "https://notifyiig.vercel.app/login" --only-categories=performance,accessibility,best-practices,seo --output=html --output-path="$env:TEMP\notifyiig-mobile.html" --chrome-flags="--headless --incognito"
npx --yes lighthouse "https://notifyiig.vercel.app/login" --preset=desktop --only-categories=performance,accessibility,best-practices,seo --output=html --output-path="$env:TEMP\notifyiig-desktop.html" --chrome-flags="--headless --incognito"
```

Expected: a representative clean run for each form factor reports 100 in all
four categories; repeat to expose hosting variance. Do not commit reports.
