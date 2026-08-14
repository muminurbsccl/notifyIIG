# Public Login, Authentication, and Performance Design

**Date:** 2026-08-14
**Status:** Approved design, pending written-spec review

## Objective

Make the public entry point correctly branded, production-safe for password and
magic-link authentication, and capable of scoring 100 in Lighthouse
Performance, Accessibility, Best Practices, and SEO on representative clean
mobile and desktop production runs.

## Architecture and components

- Replace the padded WebP with a local, tightly cropped, white-background JPEG
  at `public/brand/bscplc-logo.jpg`. The source asset is 320 pixels wide and
  retains its natural aspect ratio.
- `BrandLogo` continues to support full and compact contexts, but uses accurate
  intrinsic dimensions and responsive display sizes. Because the official
  image contains the wordmark, the component does not repeat visible
  `BSCPLC` text. Alternative text and surrounding copy retain accessible
  application context.
- Replace the client-heavy login component with server-handled password and
  magic-link form submissions using Supabase SSR cookie handling.
- Add an `/auth/callback` route that exchanges a PKCE code, accepts only a safe
  internal destination, and defaults to `/dashboard`.
- Derive production email redirects from validated server-side `APP_BASE_URL`.
  Browser origin is not an authentication configuration source.
- Add valid icon metadata, `robots.ts`, `metadataBase`, canonical metadata,
  description, and social metadata. `/login` remains indexable, while protected
  application paths are disallowed in robots directives.

## Authentication data flow

1. The server renders `/login` with minimal or no client hydration.
2. A password submission authenticates through a server boundary, writes the
   Supabase session cookies, and redirects an authorized user to `/dashboard`.
3. A magic-link submission asks Supabase to email a PKCE link whose redirect is
   `${APP_BASE_URL}/auth/callback`.
4. The callback exchanges the code, validates the resulting application
   profile through the existing authorization boundary, and redirects to the
   approved internal destination.
5. Expired links, rejected codes, inactive profiles, and provider failures
   redirect to `/login` with a safe user-facing state. Raw provider errors,
   tokens, and codes are not reflected into HTML or URLs.

## Hosted authentication configuration

Production Supabase Auth must be configured with:

- Site URL: `https://notifyiig.vercel.app`
- Redirect URL: `https://notifyiig.vercel.app/auth/callback`

The local callback remains separately allow-listed for development. Preview
deployment callbacks are not enabled unless an approved preview-auth policy is
added later. Changing hosted Auth settings is an operator step and cannot be
substituted by application code.

## Error handling and security

- Reject missing or malformed form values at the server boundary.
- Allow only relative, internal callback destinations; reject protocol-relative
  and external URLs.
- Preserve invitation-only behavior and existing active-profile checks.
- Use secure Supabase SSR cookie defaults and avoid exposing service-role
  credentials to the browser.
- Keep authentication responses generic enough to avoid account enumeration.
- Continue redirecting unauthenticated protected-route requests to `/login`.

## Performance and SEO strategy

- Remove the initial browser Supabase client and stateful sign-in method switch
  from the critical rendering path. Sign-in methods may be separate
  server-rendered forms or server-selected views.
- Serve the correctly sized local JPEG without remote requests or layout shift.
- Eliminate `/favicon.ico` and `/robots.txt` errors.
- Keep the public page free of unnecessary third-party scripts, client effects,
  and blocking resources.
- Use an indexable canonical `/login` page. Security continues to come from
  authentication and authorization, not search-engine obscurity.

## Testing and acceptance

- Test password and magic-link server submissions, cookie propagation, callback
  exchange, safe redirect validation, inactive users, expired links, and safe
  errors.
- Test that the local JPEG exists, has the declared dimensions, and is used by
  both full and compact branding.
- Test generated icon, robots, canonical, description, and social metadata.
- Run typecheck, lint, the full test suite, and a production build.
- Verify password and magic-link sign-in on production after updating Supabase
  hosted Auth settings.
- Run Lighthouse against production in mobile and desktop modes. The acceptance
  target is 100 in Performance, Accessibility, Best Practices, and SEO in a
  representative clean run for each form factor. Repeat runs are retained to
  expose hosting variance rather than conceal regressions.

## Dependencies and non-goals

This work precedes the production import and E2E release gates described in the
companion workbook-import and notification-completion specifications. It does
not add registration, social login, preview-deployment authentication, a broad
visual redesign, or new user roles.
