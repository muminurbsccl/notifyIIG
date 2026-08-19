# Login Page Redesign: Split Screen + Email-First Sign-In

**Date:** 2026-08-19
**Status:** Approved (user granted automatic approval for the recommended design)
**Feature owner:** user (operator)

## Problem

The current login page presents two equal "tabs" — **Sign-in link** and **Password** — forcing users to choose a sign-in method before doing anything. In practice nearly everyone uses the password path (a handful of admins/operators), so the tabs cause:

- **Discovery confusion** — users don't notice or understand the two modes; they pick the wrong one or miss the escape hatch.
- **Magic-link friction** — waiting for email, re-entering email when a link dies, unclear confirmation.
- **Error placement issues** — flow errors appear under a generic form, and the password path's errors discard the entered email.
- **Busy feel** — the page asks for a method decision, not a credential.

The page also looks utilitarian: a single centered card with no product identity.

## Decisions (from brainstorm, user-confirmed)

1. **Layout:** split screen — brand panel left, form panel right (user picked option B, then refinement A: full identity in the brand panel, "Sign in" + "Welcome back" in the form panel).
2. **Interaction:** email-first hybrid (user picked B over the recommended A): one email field; the server decides — password exists → password step; no password → magic link sent. Unknown email is treated identically to "no password" (anti-enumeration, user picked A).
3. **Approach 1 (steps):** URL-driven server steps — new `beginSignIn` server action redirects to `?step=password&email=…` or `?notice=link-sent`. No client-side state machine.
4. **Approach 2 (check):** one-time migration adding a `security definer` RPC `auth_user_has_password(email)` callable only by `service_role`, invoked from the server action with the existing service-role key (`getServerConfig().serviceRoleKey`). Not the `pg`/DATABASE_URL path (runtime availability unverified on Vercel) and not a no-check fallback (would abandon email-first).

## Design

### Layout

- `/login` renders a full-height split:
  - **Brand panel** (left, ~45% width): deep-blue gradient background; `BrandLogo`; product name "BSCPLC IPT NotifySystem"; tagline "Notification system for service renewal"; footer "Bangladesh Submarine Cable PLC".
  - **Form panel** (right, ~55%): heading "Sign in" + muted "Welcome back" + the active form.
- Responsive: below ~900px the brand panel collapses into a compact header band (logo + product name inline; tagline and company footer hidden), with the form panel below full-width.
- Unconfigured-Supabase notice (`notice notice-warning`, today's copy) renders inside the form panel.
- New CSS lives in `app/globals.css` under `.login-*` classes. Brand-panel gradient colors are defined once in the CSS (navy tones: `#0f172a`, `#1e3a8a`, `#1d4ed8`, `#2563eb`); no change to existing design tokens.
- Metadata (`title`, canonical, OpenGraph) unchanged. `setup-page`/`setup-card` classes remain untouched for `/setup`.

### Interaction flow

**Step 1 — email (default `/login`):**
- Single `email` field + submit button "Continue".
- Posts to new server action `beginSignIn(formData)`:
  1. `requireEmail(formData.get("email"))` — invalid → redirect `?error=invalid-input` (no provider call).
  2. Service-role client (`createClient(url, serviceRoleKey, { auth: { persistSession: false } })` from `@supabase/supabase-js`) → `rpc("auth_user_has_password", { email })`.
     - RPC failure → `?error=service-unavailable`.
  3. `true` → `redirect("/login?step=password&email=" + encodeURIComponent(email))`.
  4. `false` (passwordless or unknown email — identical path) → `signInWithOtp` with `shouldCreateUser: false` and the existing PKCE `emailRedirectTo`:
     - success → `?notice=link-sent`
     - rate-limited (status 429 / `over_email_send_rate_limit` / `over_request_rate_limit`) → `?error=rate-limited`
     - other provider error → `?error=service-unavailable`

**Step 2 — password (`?step=password&email=…`):**
- Shows the email (muted, read-only) with "Not you? Use a different email" linking to `/login`.
- Password field + submit "Sign in" → existing `signInWithPassword` action; the form includes a hidden `step=password` input and hidden `email`.
- `signInWithPassword` change: when the form carries `step=password`, error redirects preserve the step and email — `?step=password&email=<encoded>&error=…` (invalid-input, invalid-credentials, rate-limited, service-unavailable, not-authorized). Success → `/dashboard` (unchanged). Without `step` (combined form), error redirects are unchanged (`?error=…&method=password`).
- Escape hatch: inline form "Email me a sign-in link instead" with hidden email posting to the existing `requestMagicLink` → `?notice=link-sent`.

**Backward compatibility:**
- `?method=password` renders today's combined email + password form exactly (same fields, same action, same error destinations). Automation and operator flows keep working.
- `?method=link` renders today's link form (same as current default).
- `?method` continues to be echoed into password-flow error destinations (`&method=password`).
- `requestMagicLink` is unchanged.
- Success redirect `/dashboard` unchanged; the `not-authorized` and session-cleanup behavior of `signInWithPassword` is untouched.

### Migration (006)

`supabase/migrations/006_auth_user_has_password.sql`:

```sql
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

- Unknown email → no row → `false`, indistinguishable from passwordless. No caller outside `service_role` can execute it, so no enumeration vector is introduced.
- Applied to production with `scripts/apply-sql.mjs` as part of implementation.

### Error handling

All existing error keys and user-facing messages are reused verbatim (`invalid-input`, `invalid-credentials`, `not-authorized`, `invalid-link`, `rate-limited`, `service-unavailable`) plus `link-sent` notice. Errors render as today (`notice notice-warning`, `role="alert"`; `notice-success` for link-sent) inside the form panel. Provider details are never reflected.

### Components & files

| File | Change |
|---|---|
| `supabase/migrations/006_auth_user_has_password.sql` | new — RPC function + grants |
| `app/login/actions.ts` | new `beginSignIn`; `signInWithPassword` step-aware error redirects; service-role client helper |
| `components/login-form.tsx` | rework: four modes (step 1 email / step 2 password / method=password combined / method=link) |
| `components/login-brand-panel.tsx` | new — static server component for the brand panel |
| `app/login/page.tsx` | split layout; `searchParams` now `{ error?, notice?, method?, step?, email? }` |
| `app/globals.css` | `.login-*` split/panel/responsive styles |
| `tests/login-actions.test.ts` | extended: `beginSignIn` cases + step-2 redirect cases |
| `tests/login-form.test.ts` | new: renderToString cases for the four modes and notices |

No new runtime dependencies (`@supabase/supabase-js` already present). `pg` is NOT used.

### Testing

- **Unit (actions):** `beginSignIn` — has-password → step redirect with encoded email; passwordless → link-sent + `signInWithOtp` called with PKCE options; unknown email → link-sent (identical); invalid input → invalid-input without provider call; OTP rate limit → rate-limited; RPC failure → service-unavailable; input validation reuses `requireEmail`. `signInWithPassword` — with `step=password` errors preserve `?step=password&email=`; without `step`, existing expectations unchanged (all current tests stay green).
- **Unit (render):** `login-form` — step 1 shows email field only; step 2 shows email, password field, "different email" link, escape form; `method=password` shows combined form; `method=link` shows link form; `notice=link-sent` banner renders.
- **Typecheck:** `npm run typecheck` clean.
- **Live (CDP, after deploy):** step 1 → step 2 → dashboard for the operator account; unknown email → link-sent notice; `?method=password` renders combined form; no console errors; test session cleaned up afterwards.

### Out of scope

- `/setup` page, dashboard, other auth surfaces (`/auth/callback`, logout) — untouched.
- Design tokens and the rest of the app's CSS — untouched.
- New dependencies, client-side state management, i18n.

## Verification checklist

1. `npx vitest run` — full suite green (288 existing + new).
2. `npm run typecheck` — clean.
3. Migration 006 applied to production via `scripts/apply-sql.mjs`.
4. Push to `master`; Vercel deploy succeeds (site 200).
5. CDP flow: email-first password path signs in to `/dashboard`; unknown email shows link-sent notice; `?method=password` renders the combined form; zero console errors.
6. Test sessions created by verification are deleted; real sessions preserved.