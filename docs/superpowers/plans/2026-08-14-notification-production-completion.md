# Notification and Production Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply procedure-date reminder overrides, guarantee support email delivery, collapse overdue milestones safely, harden concurrent retries, and complete controlled production E2E verification.

**Architecture:** Keep milestone calculation pure, but make schedule initialization and delivery claiming transactional PostgreSQL operations. The engine resolves recipients once when creating encrypted deliveries, then retries from stored ciphertext so later configuration changes cannot strand a queued message.

**Tech Stack:** TypeScript, Supabase/PostgreSQL PL/pgSQL, Next.js cron route, Cloudflare email relay, Vitest.

## Global Constraints

- This plan begins only after the public-auth and multi-sheet-import plans are complete.
- `renewal_procedure_start_date` overrides only the first four-calendar-month milestone.
- Multiple overdue milestones create one consolidated catch-up per circuit/expiry version; later runs do not duplicate it.
- `support.iig@bsccl.com` receives every email notification, even when provider email is disabled.
- Enabled provider contacts are additional recipients; trim/lowercase deduplication occurs before delivery creation.
- Email failures never roll back imported records.
- WhatsApp and Discord remain disabled and outside the completion gate.
- Live import commit and live scheduler/email execution require separate operator confirmation.

---

## File structure

- Modify `lib/domain/date-rules.ts` for an explicit first-milestone override.
- Create `lib/notifications/recipients.ts` for mandatory support routing and canonical dedupe.
- Create `supabase/migrations/003_notification_production_completion.sql` for schedule state and atomic RPCs.
- Modify `lib/notifications/engine.ts` to use schedule/claim RPCs and stored ciphertext.
- Modify notification resend/cron behavior and tests.
- Extend `README.md` with preflight, confirmation, and production evidence steps.

### Task 1: Procedure-date milestone override

**Files:**
- Modify: `lib/domain/date-rules.ts`
- Modify: `tests/date-rules.test.ts`

**Interfaces:**
- Produces: `buildMilestones(expiryDate, definitions, options?)` where `options.firstMilestoneDueDate?: string`.

- [ ] **Step 1: Write failing override tests**

```ts
const milestones = buildMilestones("2031-10-31", definitions, {
  firstMilestoneDueDate: "2031-06-17",
});
expect(milestones.find((item) => item.key === "T-4M")?.dueDate).toBe("2031-06-17");
expect(milestones.find((item) => item.key === "T-30D")?.dueDate).toBe("2031-10-01");
expect(() => buildMilestones("2031-10-31", definitions, {
  firstMilestoneDueDate: "2031-11-01",
})).toThrow("before or on expiry");
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npx vitest run tests/date-rules.test.ts`

Expected: FAIL because no override exists.

- [ ] **Step 3: Implement explicit stable-key override**

Apply the override to the configured first milestone identified by the existing
four-month definition, not array order. Parse and validate both dates through
the existing date-only helpers; leave all later milestones unchanged.

- [ ] **Step 4: Run tests and confirm GREEN**

Run: `npx vitest run tests/date-rules.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit date behavior**

```powershell
git add lib/domain/date-rules.ts tests/date-rules.test.ts
git commit -m "feat: support procedure-date reminders"
```

### Task 2: Mandatory support recipient policy

**Files:**
- Create: `lib/notifications/recipients.ts`
- Create: `tests/recipients.test.ts`
- Modify: `lib/domain/idempotency.ts`

**Interfaces:**
- Produces: `MANDATORY_SUPPORT_EMAIL`, `canonicalEmailAddress`, and `buildEmailTargets(settings, contacts): string[]`.

- [ ] **Step 1: Write failing routing tests**

```ts
expect(buildEmailTargets({ emailEnabled: false, explicitTo: [] }, [])).toEqual([
  "support.iig@bsccl.com",
]);
expect(buildEmailTargets({ emailEnabled: true, explicitTo: [" SUPPORT.IIG@BSCCL.COM "] }, [
  { active: true, type: "recipient", email: "person@example.com" },
])).toEqual(["support.iig@bsccl.com", "person@example.com"]);
```

Also test missing contacts, inactive contacts, duplicate contact/explicit To, and
case-insensitive target hashes.

- [ ] **Step 2: Run tests and confirm RED**

Run: `npx vitest run tests/recipients.test.ts tests/idempotency.test.ts`

Expected: FAIL for missing policy module.

- [ ] **Step 3: Implement deterministic email routing**

```ts
export const MANDATORY_SUPPORT_EMAIL = "support.iig@bsccl.com";

export function canonicalEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}
```

Always add support first. Add optional recipients only when provider email is
enabled; dedupe before delivery creation.

- [ ] **Step 4: Run tests and confirm GREEN**

Run: `npx vitest run tests/recipients.test.ts tests/idempotency.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit recipient policy**

```powershell
git add lib/notifications/recipients.ts lib/domain/idempotency.ts tests/recipients.test.ts tests/idempotency.test.ts
git commit -m "feat: require IIG support notifications"
```

### Task 3: Transactional schedule state and catch-up migration

**Files:**
- Create: `supabase/migrations/003_notification_production_completion.sql`
- Create: `tests/migration-003.test.ts`
- Modify: `tests/schema.test.ts`

**Interfaces:**
- Produces: `notification_milestone_states`, event catch-up metadata, and `ensure_due_notification_events(...)` RPC.

- [ ] **Step 1: Write failing migration tests**

Assert unique `(circuit_id, expiry_version, milestone_key)` state, state values
`satisfied|event_created`, event `is_catch_up`, event catch-up milestone list, service-
role-only RPC grant, actor-independent cron use, row locking, deterministic
due-date/key ordering, no mutation of old expiry-version state, and a procedure-
date edit incrementing `expiry_version` while cancelling old pending events.

- [ ] **Step 2: Run tests and confirm RED**

Run: `npx vitest run tests/migration-003.test.ts tests/schema.test.ts`

Expected: FAIL because migration 003 does not exist.

- [ ] **Step 3: Add schedule state and event metadata**

```sql
create table public.notification_milestone_states (
  circuit_id uuid not null references public.circuits(id) on delete cascade,
  expiry_version integer not null,
  milestone_key text not null,
  due_date date not null,
  state text not null check (state in ('satisfied', 'event_created')),
  event_id uuid references public.notification_events(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (circuit_id, expiry_version, milestone_key)
);
```

Add `notification_events.is_catch_up boolean not null default false` and
`notification_events.catch_up_milestone_keys text[] not null default '{}'`.
Extend the existing circuit schedule-version trigger so a changed
`renewal_procedure_start_date` increments `expiry_version` and cancels pending
or processing events from the old version without creating a false renewal-
history expiry entry. The existing circuit API audit records the field change.

- [ ] **Step 4: Implement atomic due-event RPC**

`ensure_due_notification_events` accepts circuit/version/rule and a validated
JSON array of due `{ key, label, dueDate }` values. Under a circuit/version lock:

- first initialization with multiple due entries marks all but the latest
  `satisfied` and creates one catch-up event for the latest;
- first initialization with one due entry creates one normal event;
- later calls create only newly due keys without state;
- ties sort by `dueDate`, then `key`;
- the function returns only newly created event IDs.

- [ ] **Step 5: Run migration tests and optional database lint**

Run: `npx vitest run tests/migration-003.test.ts tests/schema.test.ts`

If available: `npx supabase db lint`

Expected: PASS.

- [ ] **Step 6: Commit schedule migration**

```powershell
git add supabase/migrations/003_notification_production_completion.sql tests/migration-003.test.ts tests/schema.test.ts
git commit -m "feat: add idempotent catch-up schedules"
```

### Task 4: Engine schedule integration and support deliveries

**Files:**
- Modify: `lib/notifications/engine.ts`
- Modify: `tests/engine.test.ts`
- Modify: `tests/channels.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 and circuit `renewal_procedure_start_date` from migration 002.
- Produces: scheduler events/deliveries with consolidated catch-up and mandatory support.

- [ ] **Step 1: Write failing engine scenarios**

Cover override selection, calendar fallback, several overdue milestones creating
one event, older states satisfied, second run creating zero events/deliveries,
new expiry version creating a new schedule, support-only delivery, support plus
contact, disabled-provider support delivery, and case-insensitive dedupe.

- [ ] **Step 2: Run tests and confirm RED**

Run: `npx vitest run tests/engine.test.ts tests/channels.test.ts`

Expected: FAIL because the engine still upserts every due event and has no mandatory recipient.

- [ ] **Step 3: Select procedure date and call the schedule RPC**

Include `renewal_procedure_start_date` and `verified_at` in circuit selection.
Build due milestones, call `ensure_due_notification_events`, and create
deliveries only for returned new events.

- [ ] **Step 4: Resolve and encrypt final targets once**

Use `buildEmailTargets` before delivery insertion. Keep one encrypted delivery
per final target and preserve existing channel independence.

- [ ] **Step 5: Run engine tests and confirm GREEN**

Run: `npx vitest run tests/engine.test.ts tests/channels.test.ts tests/date-rules.test.ts tests/recipients.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit engine integration**

```powershell
git add lib/notifications/engine.ts tests/engine.test.ts tests/channels.test.ts
git commit -m "feat: collapse overdue notification milestones"
```

### Task 5: Atomic delivery claiming and ciphertext-based retries

**Files:**
- Modify: `supabase/migrations/003_notification_production_completion.sql`
- Modify: `lib/notifications/engine.ts`
- Modify: `app/api/notifications/[id]/resend/route.ts`
- Create: `scripts/verify-notification-claims.mjs`
- Modify: `tests/engine.test.ts`
- Modify: `tests/notifications.test.ts`
- Modify: `tests/retry.test.ts`

**Interfaces:**
- Produces: `claim_notification_deliveries(p_limit)` RPC and retries that dispatch from stored target ciphertext.

- [ ] **Step 1: Write failing claim/retry/resend tests**

Assert concurrent claims cannot return the same delivery, stored ciphertext is
used even after provider settings change, resend copies ciphertext, retryable
failures stop at `MAX_DELIVERY_RETRIES`, and permanent failures are never
rescheduled.

- [ ] **Step 2: Run tests and confirm RED**

Run: `npx vitest run tests/engine.test.ts tests/notifications.test.ts tests/retry.test.ts tests/migration-003.test.ts`

Expected: FAIL against select-then-update claiming and configuration re-resolution.

- [ ] **Step 3: Add a `FOR UPDATE SKIP LOCKED` claim RPC**

The service-role RPC atomically changes eligible `queued|retry_scheduled` rows
to `sending`, increments attempts, and returns only claimed allowlisted fields.
Grant execution only to `service_role`.

- [ ] **Step 4: Dispatch from encrypted target state**

Decrypt `target_ciphertext` for the claimed delivery; fetch event/circuit data
only for message context. Do not require the target to remain in current
provider settings. Ensure resend copies the original ciphertext and hash.

- [ ] **Step 5: Enforce retry classification and event outcome**

Schedule only retryable failures below the retry limit. Mark exhausted/permanent
deliveries failed and use `partial_failure` when an event has mixed outcomes.

- [ ] **Step 6: Run focused tests and confirm GREEN**

Run: `npx vitest run tests/engine.test.ts tests/notifications.test.ts tests/retry.test.ts tests/migration-003.test.ts`

Expected: PASS.

- [ ] **Step 7: Verify locking against a disposable PostgreSQL database**

Create a script that inserts synthetic eligible deliveries inside a dedicated
test transaction, opens two independent `pg` clients, invokes
`claim_notification_deliveries` concurrently, asserts the returned delivery-ID
sets are disjoint, and removes the synthetic rows. Refuse to run unless
`ALLOW_NOTIFICATION_CLAIM_TEST=true` and the database hostname is localhost or
the database name ends in `_test`.

Run:

```powershell
$env:ALLOW_NOTIFICATION_CLAIM_TEST="true"
node --env-file=.env.local scripts/verify-notification-claims.mjs
```

Expected: `PASS: concurrent claims were disjoint`. Never run this script against
production.

- [ ] **Step 8: Commit concurrency hardening**

```powershell
git add supabase/migrations/003_notification_production_completion.sql lib/notifications/engine.ts "app/api/notifications/[id]/resend/route.ts" scripts/verify-notification-claims.mjs tests/engine.test.ts tests/notifications.test.ts tests/retry.test.ts tests/migration-003.test.ts
git commit -m "fix: claim notification deliveries atomically"
```

### Task 6: Preflight visibility, audit, and operator runbook

**Files:**
- Modify: `app/api/cron/expiry-notifications/route.ts`
- Modify: `tests/notifications.test.ts`
- Modify: `README.md`

**Interfaces:**
- Produces: safe cron summary/audit evidence and explicit production confirmation gates.

- [ ] **Step 1: Write failing safe-summary/audit tests**

Assert cron still requires exact bearer auth, returns only allowlisted counts,
writes a redacted job audit summary, and never returns targets, ciphertext,
provider responses, or secrets.

- [ ] **Step 2: Run tests and confirm RED**

Run: `npx vitest run tests/notifications.test.ts`

Expected: FAIL for missing cron audit evidence.

- [ ] **Step 3: Add redacted job audit and preflight documentation**

Record business date and counts only. Document read-only preflight counts by
eligible circuit/version, expected one support delivery per event, import-commit
confirmation, live-email confirmation, and duplicate-free second run.

- [ ] **Step 4: Run the full repository gate**

Run: `npm test -- --run && npm run typecheck && npm run lint && npm run build`

Expected: PASS.

- [ ] **Step 5: Commit operational visibility**

```powershell
git add app/api/cron/expiry-notifications/route.ts tests/notifications.test.ts README.md
git commit -m "feat: audit notification jobs"
```

### Task 7: Controlled production completion

**Files:**
- No repository edits unless verification finds a documented defect.
- Local-only evidence under the approved temporary directory; do not commit secrets, workbook data, or Lighthouse reports.

**Interfaces:**
- Consumes: all three completed implementation plans and external Supabase/Vercel/email services.

- [ ] **Step 1: Run final local verification**

Run: `npm test -- --run && npm run typecheck && npm run lint && npm run build`

Expected: PASS with zero pending repository changes except intentional commits.

- [ ] **Step 2: Verify migration 002, apply migration 003, and verify**

```powershell
node --env-file=.env.local scripts/apply-sql.mjs supabase/migrations/003_notification_production_completion.sql
```

First verify migration 002 is already present from the importer release. Then
verify migration 003 RLS, RPC grants, and schedule-state uniqueness before
import. Do not reapply migration 002 as a substitute for migration tracking.

- [ ] **Step 3: Deploy and verify authentication/public routes**

Confirm Vercel deployment readiness, Supabase Site/callback configuration,
password login, fresh magic link, `/login`, `/robots.txt`, icon/favicon,
protected redirects, and cron unauthorized `401`.

- [ ] **Step 4: Preview and explicitly approve import commit**

Preview the private workbook through the authenticated UI. Stop on material
count discrepancy or any blocking error. Obtain operator confirmation, commit,
then verify 20 expected active and 3 expected draft records, ownership,
identifiers, dates, lineage, and audit evidence.

- [ ] **Step 5: Preflight and explicitly approve live email**

Calculate eligible circuit/version count and expected mandatory support delivery
count without invoking cron. Show the counts to the operator and obtain a
separate confirmation for the live send.

- [ ] **Step 6: Run cron once and verify deliveries**

```powershell
Invoke-WebRequest -Uri "https://notifyiig.vercel.app/api/cron/expiry-notifications" -Headers @{ Authorization = "Bearer $env:CRON_SECRET" } | Select-Object -ExpandProperty Content
```

Confirm one catch-up per eligible initialized record, older milestones
satisfied, mandatory support plus deduplicated contacts, encrypted targets,
accepted relay IDs, and no WhatsApp/Discord attempts.

- [ ] **Step 7: Run cron a second time and prove idempotency**

Repeat the authenticated request. Expected: zero new catch-up events and zero
duplicate deliveries; inspect database uniqueness/audit evidence.

- [ ] **Step 8: Run final production Lighthouse audits**

Run the mobile and desktop commands from the public-login plan. Expected: a
representative clean production run reports 100 in Performance, Accessibility,
Best Practices, and SEO for each form factor.

- [ ] **Step 9: Record remaining external risks**

Document unavailable WhatsApp/Discord approvals, hosting-plan approval, Vercel
restart/redeploy requirements, and the excluded historical `PRD.docx` Git
history purge. Do not rewrite history or force-push without separate explicit
authorization.
