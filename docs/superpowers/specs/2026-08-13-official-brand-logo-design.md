# Official BSCPLC Logo Design

**Date:** 2026-08-13
**Status:** Approved design, pending written-spec review

## Objective

Replace the placeholder letter mark with the official BSCPLC logo supplied at
`https://bsccl.com.bd/uploads/site/logo.webp`, while preserving the current
responsive lockup, accessible text, and application identity.

## Design

- Download the approved asset once to `public/brand/bscplc-logo.webp` and track
  that local copy in Git.
- Render the local file with Next.js `Image`; do not load the production logo
  from a third-party URL at runtime.
- Keep the visible text `BSCPLC` and, outside compact mode, the subtitle
  `Circuit notifications`.
- Give the image descriptive alternate text (`BSCPLC logo`) and remove the old
  decorative `B` placeholder.
- Retain the existing `BrandLogo({ compact?: boolean })` interface so login,
  setup, and application-shell consumers require no changes.
- Update logo CSS for the asset's natural aspect ratio, consistent visual size,
  and responsive compact presentation.

## Error and Deployment Behavior

- The image is bundled with the Vercel deployment, so the app remains branded
  if the source website is unavailable or changes the remote file.
- No remote-image domain configuration is required.
- If the local file is missing, the build or component test must fail before
  deployment.

## Verification

- A component/foundation test confirms the local file exists and the brand
  component references it.
- Typecheck, lint, full tests, and production build pass.
- Local `/login` and production `/login` return 200 after deployment.
- Inspect the resulting page to ensure compact and full lockups remain usable.

## Non-Goals

- No broader color/token redesign.
- No favicon or social-card generation.
- No modification or recoloring of the supplied logo.
