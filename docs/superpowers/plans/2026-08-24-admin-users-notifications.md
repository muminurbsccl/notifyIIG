# Invitation-Only Admin Users and Notification Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure invitation-only user administration, usable responsibility assignment, and professional notification emails while auditing the dashboard/profile workflows.

**Architecture:** Admin user operations run through server-only API routes backed by Supabase Auth admin APIs and service-role profile updates. Active profile data is loaded server-side and passed into existing forms as selector options. Notification rendering is centralized in the existing notification engine and keeps the current adapter contracts.

**Tech Stack:** Next.js App Router, TypeScript, Supabase Auth/Postgres, React, Vitest, Vercel.

## Global Constraints

- Registration remains invitation-only; do not enable public signup.
- Passwords never enter source control, profile rows, logs, audit payloads, or client-rendered HTML.
- Only active admins may manage users.
- Never allow deleting, deactivating, or demoting the last active admin.
- Preserve existing email, WhatsApp, and Discord adapter contracts.
- Escape dynamic email values and preserve plain-text fallback.
- No new dependencies.

---

### Task 1: Secure admin user API and Users page

**Files:**
- Create: `app/api/users/route.ts`
- Create: `app/api/users/[id]/route.ts`
- Create: `app/(app)/users/page.tsx`
- Create: `components/user-management.tsx`
- Modify: `components/app-shell.tsx`
- Test: `tests/user-management.test.ts`

**Interfaces:**
- `GET /api/users` returns safe profile/auth metadata for admins only.
- `POST /api/users` accepts `{ email, fullName, role, active, password? }`; it creates an invited or confirmed Auth user and updates the trigger-created profile.
- `PATCH /api/users/:id` accepts profile fields and optional password; it never returns a password.
- `DELETE /api/users/:id` deletes an Auth user after self/last-admin checks.

- [ ] Write failing tests for non-admin rejection, create/update/delete validation, password redaction, and last-admin protection.
- [ ] Run `npx vitest run tests/user-management.test.ts` and verify the new tests fail.
- [ ] Implement server-only service-role operations and safe response mapping.
- [ ] Implement the admin Users page with create/edit/deactivate/password/delete controls.
- [ ] Add `/users` to the app navigation.
- [ ] Run focused tests and typecheck.
- [ ] Commit with `feat(auth): add invitation-only admin user management`.

### Task 2: Active-user selectors and responsibility assignment

**Files:**
- Create: `lib/admin-profiles.ts`
- Modify: `components/circuit-form.tsx`
- Modify: `components/provider-form.tsx`
- Modify: `app/(app)/circuits/new/page.tsx`
- Modify: `app/(app)/circuits/[id]/page.tsx`
- Modify: `app/(app)/providers/page.tsx`
- Modify: `app/(app)/providers/[id]/page.tsx`
- Test: `tests/responsibility-assignment.test.ts`

**Interfaces:**
- `listActiveProfiles(client)` returns `{ id, email, full_name, role }[]` for admin/editor form rendering.
- Existing payload field names remain UUID-based: `ownerUserId`, `backupOwnerUserId`, `primaryOwnerUserId`, `backupOwnerUserId`.

- [ ] Add failing render/data tests proving active profiles become options and selected UUIDs round-trip.
- [ ] Replace raw owner UUID inputs with labeled selects, retaining `ownerOverride` text.
- [ ] Ensure provider and circuit pages pass active profiles into forms.
- [ ] Verify role permissions remain unchanged for managers/viewers.
- [ ] Run focused tests and typecheck.
- [ ] Commit with `feat(operations): add responsible-user selectors`.

### Task 3: Professional HTML notification email

**Files:**
- Modify: `lib/notifications/engine.ts`
- Modify: `lib/domain/templates.ts` if needed for shared escaping/rendering.
- Test: `tests/notifications-email-template.test.ts`

**Interfaces:**
- Existing `EmailSendInput` remains unchanged.
- Default `bodyHtml` becomes a complete email-safe document fragment with branded header, summary table, CTA copy, and footer.
- `bodyText` contains the same essential facts without markup.

- [ ] Add failing tests for required branding/content, dynamic-value escaping, plain-text fallback, and override preservation.
- [ ] Implement a dedicated pure builder for the default expiry email.
- [ ] Use it at the engine dispatch point without changing WhatsApp/Discord variables.
- [ ] Run focused channel/notification tests.
- [ ] Commit with `feat(notifications): add professional expiry email template`.

### Task 4: Verification, production accounts, deployment, and audit

**Files:**
- Modify: documentation only if verification finds stale workflow instructions.
- Create: `scripts/provision-invitation-users.mjs` only if a local operational script is needed; it must read passwords from environment variables and never contain credentials.

- [ ] Run full `npx vitest run` and `npm run typecheck`.
- [ ] Push and deploy to Vercel.
- [ ] Provision the requested support account with its supplied password through Supabase Auth admin API without committing the password.
- [ ] Promote `muminurbsccl@gmail.com` to active admin and verify the profile.
- [ ] Smoke-test Users, Dashboard, Circuits, Providers, Notifications, Audit, Settings, and Imports as admin.
- [ ] Exercise controlled channel tests for every configured channel; record success/failure and external IDs without exposing secrets.
- [ ] Verify the professional email arrives in HTML and text-capable clients where possible.
- [ ] Review git status, deployment URL, and remaining risks.
