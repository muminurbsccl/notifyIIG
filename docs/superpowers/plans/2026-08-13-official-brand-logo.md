# Official BSCPLC Logo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan one task at a time. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder B mark with a locally bundled copy of the official BSCPLC logo while preserving the current brand lockup interface and accessibility.

**Architecture:** Download the approved WebP asset into `public/brand`, render it through Next.js `Image`, and retain the existing visible brand text. A foundation test verifies both the local asset and component reference so missing branding fails before deployment.

**Tech Stack:** Next.js 15, React 19, TypeScript, CSS, Vitest, WebP.

## Global Constraints

- Source asset: `https://bsccl.com.bd/uploads/site/logo.webp`.
- Tracked asset: `public/brand/bscplc-logo.webp`.
- Runtime must use the local asset, never the remote URL.
- Preserve `BrandLogo({ compact?: boolean })` and visible `BSCPLC` / `Circuit notifications` copy.
- Image alternate text is `BSCPLC logo`.
- Do not modify or recolor the supplied file.
- Do not change unrelated colors, tokens, favicon, or social cards.

---

### Task 1: Bundle and render the official logo

**Files:**
- Create: `public/brand/bscplc-logo.webp`
- Modify: `components/brand-logo.tsx`
- Modify: `app/globals.css`
- Modify: `tests/foundation.test.ts`

**Interfaces:**
- Preserves: `BrandLogo({ compact?: boolean }): ReactElement`
- Produces: local image path `/brand/bscplc-logo.webp`

- [ ] **Step 1: Write the failing branding test**

Extend `tests/foundation.test.ts` to read `public/brand/bscplc-logo.webp`, require more than 1,000 bytes, read `components/brand-logo.tsx`, and assert it contains `/brand/bscplc-logo.webp` and `alt="BSCPLC logo"`.

- [ ] **Step 2: Run RED**

Run:

```powershell
npm test -- --run tests/foundation.test.ts
```

Expected: fail because the local logo file and component reference do not exist.

- [ ] **Step 3: Download and validate the exact asset**

Create `public/brand` and download the supplied URL to `public/brand/bscplc-logo.webp`. Confirm HTTP 200, file length greater than 1,000 bytes, and WebP RIFF signature (`RIFF....WEBP`). Do not transform the file.

- [ ] **Step 4: Render with Next.js Image**

Import `Image` from `next/image`. Replace the `.brand-mark` placeholder span with:

```tsx
<Image
  alt="BSCPLC logo"
  className="brand-logo-image"
  height={56}
  priority
  src="/brand/bscplc-logo.webp"
  width={180}
/>
```

Keep the existing wrapper, compact class, `BSCPLC` text, and conditional subtitle unchanged.

- [ ] **Step 5: Update focused CSS**

Replace `.brand-mark` sizing/color rules with `.brand-logo-image` rules using `display:block`, `width:auto`, `height:44px`, and `object-fit:contain`. Set compact/sidebar height to `32px`; preserve existing lockup spacing and copy styles. Remove unused `.brand-mark` rules.

- [ ] **Step 6: Run GREEN and full verification**

Run:

```powershell
npm test -- --run tests/foundation.test.ts
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

Expected: all pass.

- [ ] **Step 7: Commit and push**

Review staged files and secret scan, then commit:

```powershell
git add public/brand/bscplc-logo.webp components/brand-logo.tsx app/globals.css tests/foundation.test.ts
git commit -m "feat: add official BSCPLC logo"
git push origin master
```

- [ ] **Step 8: Verify production deployment**

Wait for Vercel's Git deployment to become Ready. Confirm `https://notifyiig.vercel.app/login` returns 200 and the HTML references `bscplc-logo.webp`.

## Plan Self-Review

- Spec coverage: local bundling, `next/image`, accessible alt text, preserved compact API/copy, focused CSS, tests, build, and production check are all covered.
- Placeholder scan: no deferred implementation instructions.
- Interface consistency: component signature and local asset path are identical across code and test steps.
