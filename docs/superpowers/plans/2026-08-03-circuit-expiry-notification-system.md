# BSCPLC Circuit Expiry Notification System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan one task at a time. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Vercel-compatible Next.js MVP that securely onboards BSCPLC upstream circuits, calculates date-based expiry milestones, sends idempotent multi-channel notifications, and records an auditable operational history.

**Architecture:** Use Next.js App Router and TypeScript for the UI and serverless route handlers, Supabase Auth/Postgres for invitation-only identity and durable relational data, and one secured daily Vercel Cron route. Keep calendar arithmetic, routing precedence, importer classification, idempotency and retry classification in pure modules with unit tests; keep channel credentials and outbound calls server-side.

**Tech Stack:** Next.js 15, React 19, TypeScript, Supabase JS/SSR, PostgreSQL SQL migration with RLS, Zod, SheetJS (`xlsx`), Vitest, native `fetch`, Vercel Cron, plain accessible CSS.

## Global Constraints

- The default reminder is exactly four calendar months before expiry; use end-of-month handling, not a fixed 120-day approximation.
- Scheduler dates use the `Asia/Dhaka` business date and date-only ISO values; browser timezone must not affect eligibility.
- Only verified circuits with `Active` or `Renewal Pending` status may enter notification scheduling.
- Routing precedence is circuit override → provider setting → organization/global default.
- Event and delivery uniqueness must prevent duplicate sends on cron retry or concurrent invocation.
- Email, WhatsApp and Discord calls are independent; one channel failure must not suppress other channels.
- WhatsApp uses only the official Cloud API, an approved utility template and recipients with recorded opt-in and valid E.164 numbers.
- Webhook URLs, API tokens, service-role keys and encryption material are server-only and never committed or returned to ordinary clients.
- The supplied workbook has no trustworthy expiry register; imports create drafts and must never invent expiry dates.
- Invoice numbers are references, never silently promoted to durable circuit identifiers.
- The official BSCPLC logo and approved brand guide are absent; use an explicit text fallback and document the asset replacement path.
- Vercel Hobby is a proof-of-concept deployment target only; production requires an approved commercial plan or alternative approved host.
- This workspace is not a Git repository; do not initialize Git or issue commit commands. Review changes with file lists, diffs where available, and command output.

---

## File Map

### Project and deployment

- Create `package.json`: scripts and runtime/dev dependencies.
- Create `tsconfig.json`, `next-env.d.ts`, `next.config.ts`, `vitest.config.ts`, `.eslintrc.json`, `.gitignore`.
- Create `.env.example`: variable names and safe comments only.
- Create `vercel.json`: one daily cron at `03:00 UTC`.
- Create `README.md`: local setup, Supabase migration/seed, Vercel deployment, channel configuration, testing, and Hobby terms warning.

### Database and domain

- Create `supabase/migrations/001_initial.sql`: tables, indexes, constraints, helper functions, trigger and RLS policies.
- Create `supabase/seed.sql`: seven provider drafts from the workbook, with no invented contract dates or recipients.
- Create `lib/domain/date-rules.ts`: pure date and milestone calculations.
- Create `lib/domain/routing.ts`: generic precedence resolution and recipient filtering.
- Create `lib/domain/idempotency.ts`: stable target hashing and delivery keys.
- Create `lib/domain/import-normalizer.ts`: pure workbook row classification and preview types.
- Create `lib/domain/retry.ts`: transient/permanent error classification and bounded retry decision.
- Create `lib/domain/templates.ts`: escaped variable interpolation and plain-text/HTML rendering inputs.
- Create `tests/date-rules.test.ts`, `tests/routing.test.ts`, `tests/idempotency.test.ts`, `tests/import-normalizer.test.ts`, `tests/retry.test.ts`.

### Server and integrations

- Create `lib/config.ts`: runtime environment parsing without logging secret values.
- Create `lib/supabase/server.ts`, `lib/supabase/browser.ts`, `lib/supabase/service.ts`.
- Create `lib/auth.ts`: profile lookup and role/provider authorization helpers.
- Create `lib/audit.ts`: redacted audit insertion.
- Create `lib/data.ts`: authenticated read/write helpers for dashboard, providers, circuits and notifications.
- Create `lib/import/xlsx.ts`: bounded SheetJS parsing and normalized preview conversion.
- Create `lib/integrations/email.ts`, `lib/integrations/whatsapp.ts`, `lib/integrations/discord.ts`: server-only channel adapters.
- Create `lib/notifications/engine.ts`: due-event creation, delivery claiming, adapter dispatch and result persistence.

### Next.js application

- Create `middleware.ts`: Supabase session refresh and protected-route redirect.
- Create `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `app/login/page.tsx`, `app/setup/page.tsx`.
- Create `app/(app)/layout.tsx` and pages for dashboard, circuits, providers, imports, notifications, settings and audit.
- Create `components/brand-logo.tsx`, `components/app-shell.tsx`, `components/status-badge.tsx`, `components/metric-card.tsx`, `components/empty-state.tsx`.
- Create `components/circuit-form.tsx`, `components/import-workflow.tsx`, `components/resend-dialog.tsx`.

### API routes

- Create `app/api/circuits/route.ts` and `app/api/circuits/[id]/route.ts`.
- Create `app/api/providers/route.ts` and `app/api/providers/[id]/route.ts`.
- Create `app/api/import/preview/route.ts` and `app/api/import/commit/route.ts`.
- Create `app/api/notifications/[id]/resend/route.ts` and `app/api/channels/test/route.ts`.
- Create `app/api/cron/expiry-notifications/route.ts`.

### Task boundaries

1. Foundation and pure domain rules are independent of Supabase credentials and
   can be reviewed with local tests.
2. The schema/auth task provides the persistence contracts consumed by API and
   notification tasks.
3. API/import and notification tasks are separate server concerns but share the
   schema and auth helpers.
4. UI consumes the stable API/domain interfaces and does not contain secrets or
   business-rule duplicates.

---

## Task 1: Scaffold the Vercel-native Next.js project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next-env.d.ts`
- Create: `next.config.ts`
- Create: `vitest.config.ts`
- Create: `.eslintrc.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `vercel.json`
- Create: `app/layout.tsx`
- Create: `app/page.tsx`
- Create: `app/globals.css`
- Create: `app/setup/page.tsx`
- Create: `components/brand-logo.tsx`
- Create: `components/app-shell.tsx`

**Interfaces:**
- Produces the Next.js runtime, `npm run dev`, `npm run lint`, `npm test`,
  `npm run build`, and the layout used by all later pages.
- `components/brand-logo.tsx` exports `BrandLogo({ compact?: boolean }): JSX.Element`.
- `components/app-shell.tsx` exports `AppShell({ children, userLabel, role }): JSX.Element`.
- `app/setup/page.tsx` is public and explains missing Supabase environment setup.

- [x] **Step 1: Write the package and compiler configuration**

Use these scripts and dependency families so the project can be built without
global tools:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "test": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@supabase/ssr": "^0.7.0",
    "@supabase/supabase-js": "^2.53.0",
    "next": "^15.4.6",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "xlsx": "^0.18.5",
    "zod": "^3.25.67"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/react": "^19.0.2",
    "@types/react-dom": "^19.0.2",
    "eslint": "^9.17.0",
    "eslint-config-next": "^15.4.6",
    "typescript": "^5.7.2",
    "vitest": "^3.2.4"
  }
}
```

Configure strict TypeScript, the `@/*` path alias, Vitest Node environment,
and ESLint to ignore `.next`, `node_modules`, `coverage` and generated files.

- [x] **Step 2: Add deployment-safe environment and cron configuration**

Create `.env.example` with names only and comments that distinguish browser
public values from server-only values. Create `vercel.json` with exactly:

```json
{
  "crons": [
    {
      "path": "/api/cron/expiry-notifications",
      "schedule": "0 3 * * *"
    }
  ]
}
```

Do not place example tokens, realistic email addresses, webhook URLs or API keys
in any file.

- [x] **Step 3: Create the initial accessible shell**

Create `app/layout.tsx` with English metadata, `app/page.tsx` redirecting to
`/dashboard`, and `app/setup/page.tsx` with setup instructions. Add global CSS
using provisional PRD colors, visible focus states, semantic headings, responsive
cards/tables and reduced-motion support. `BrandLogo` should render the text
`BSCPLC` and product name until `/bscplc-logo.svg` is supplied; it must not
invent an official logo.

- [x] **Step 4: Install dependencies and run the baseline checks**

Run:

```powershell
npm install
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

Expected: all commands exit `0`; the project builds without requiring runtime
Supabase credentials because data pages are dynamic and setup is public.

---

## Task 2: Implement pure business rules with tests first

**Files:**
- Create: `lib/domain/date-rules.ts`
- Create: `lib/domain/routing.ts`
- Create: `lib/domain/idempotency.ts`
- Create: `lib/domain/import-normalizer.ts`
- Create: `lib/domain/retry.ts`
- Create: `lib/domain/templates.ts`
- Create: `tests/date-rules.test.ts`
- Create: `tests/routing.test.ts`
- Create: `tests/idempotency.test.ts`
- Create: `tests/import-normalizer.test.ts`
- Create: `tests/retry.test.ts`

**Interfaces:**
- `calculateInitialReminder(expiryDate: string): string` returns an ISO date.
- `getDhakaBusinessDate(now?: Date): string` returns an ISO date.
- `buildMilestones(expiryDate: string, enabled: MilestoneDefinition[]): DueMilestone[]` returns deterministic due dates.
- `resolveSetting<T>(circuit: T | null, provider: T | null, global: T | null): ResolvedSetting<T>` returns `{ value, source }`.
- `buildTargetHash(channel: string, target: string): string` and `buildIdempotencyKey(eventId: string, channel: string, target: string): string` return stable SHA-256-based values.
- `normalizeWorkbookRows(rows: unknown[][]): ImportPreview` separates `circuitCandidates`, `invoiceReferences`, `providers`, and `issues`.
- `classifyDeliveryError(status: number | null, message: string): RetryClassification` returns `transient` or `permanent` with a bounded retry decision.
- `renderTemplate(template: string, variables: Record<string, string>): string` escapes HTML values and preserves a plain-text rendering path.

- [x] **Step 1: Write failing date-rule tests**

Include these cases:

```ts
expect(calculateInitialReminder("2026-08-31")).toBe("2026-04-30");
expect(calculateInitialReminder("2028-02-29")).toBe("2027-10-29");
expect(calculateInitialReminder("2027-05-31")).toBe("2027-01-31");
expect(getDhakaBusinessDate(new Date("2026-08-02T18:30:00.000Z"))).toBe("2026-08-03");
expect(getDhakaBusinessDate(new Date("2026-08-03T18:00:00.000Z"))).toBe("2026-08-04");
```

Run `npm test -- --run tests/date-rules.test.ts`; it must fail before the
implementation exists.

- [x] **Step 2: Implement date-only arithmetic and milestone generation**

Parse `YYYY-MM-DD` into UTC components, subtract calendar months by changing
year/month, clamp the day to the target month's final day, and format ISO dates.
Use `Intl.DateTimeFormat` with `timeZone: "Asia/Dhaka"` for business-date
conversion. Do not call `new Date("YYYY-MM-DD")` for comparison logic.

- [x] **Step 3: Add routing, idempotency and retry tests**

Test circuit/provider/global precedence and `source` values, unequal target
hashes for different recipients, equal keys for repeated identical inputs,
retryable 429/5xx/network errors, and permanent 400/validation errors.

- [x] **Step 4: Implement the routing, idempotency and retry modules**

Use a generic nullable value type for routing. Normalize targets with trim and
lowercase for email/webhook hashes; preserve E.164 digits and leading `+` for
WhatsApp. Bound retry attempts at three and calculate exponential delays of
60s, 300s and 900s.

- [x] **Step 5: Add importer and template tests**

Use representative rows from the PRD:

```ts
expect(normalizeWorkbookRows([
  ["Provider", "Circuit/Link ID", "Invoice No."],
  ["NTT", "USID-300381", "INV-1"],
  ["COGENT", "", "INV-2"]
]).circuitCandidates[0].externalCircuitId).toBe("USID-300381");
expect(normalizeWorkbookRows([
  ["Provider", "Circuit/Link ID", "Invoice No."],
  ["COGENT", "", "INV-2"]
]).invoiceReferences[0].referenceNumber).toBe("INV-2");
```

Test duplicate identifiers, blank headings, mixed IP/LAG text, Sheet2 narrative
rows and unknown template variables.

- [x] **Step 6: Implement importer and safe template rendering**

Return explicit issue codes such as `MISSING_PROVIDER`, `INVOICE_ONLY`,
`AMBIGUOUS_IDENTIFIER` and `DUPLICATE_IDENTIFIER`. Escape `&`, `<`, `>`, `"`
and apostrophes in HTML output; keep plain text free of HTML tags.

- [x] **Step 7: Run the pure test suite and typecheck**

Run:

```powershell
npm test -- --run tests/date-rules.test.ts tests/routing.test.ts tests/idempotency.test.ts tests/import-normalizer.test.ts tests/retry.test.ts
npm run typecheck
```

Expected: all domain tests pass and no domain module imports Next.js, Supabase,
or browser-only APIs.

---

## Task 3: Add Supabase schema, RLS, authentication and seed data

**Files:**
- Create: `supabase/migrations/001_initial.sql`
- Create: `supabase/seed.sql`
- Create: `lib/config.ts`
- Create: `lib/supabase/server.ts`
- Create: `lib/supabase/browser.ts`
- Create: `lib/supabase/service.ts`
- Create: `lib/auth.ts`
- Create: `lib/audit.ts`
- Create: `middleware.ts`
- Create: `app/login/page.tsx`

**Interfaces:**
- `getPublicConfig(): { supabaseUrl: string | null; supabaseAnonKey: string | null; configured: boolean }` never returns server secrets.
- `createServerSupabaseClient()` uses request cookies and anon key.
- `createBrowserSupabaseClient()` uses only public Supabase values.
- `createServiceSupabaseClient()` throws if called without server-only service credentials.
- `requireProfile(roles?: AppRole[]): Promise<{ user: User; profile: Profile; supabase: SupabaseClient }>` redirects or throws a typed authorization error.
- `canAccessProvider(profile: Profile, providerId: string): boolean` is the application-side scope check.
- `writeAudit(input: AuditInput): Promise<void>` redacts secret keys before insertion.

- [x] **Step 1: Write the SQL schema and extensions**

Create UUID-backed tables for `profiles`, `providers`, `provider_contacts`,
`provider_notification_settings`, `circuits`, `renewal_history`,
`notification_rules`, `notification_milestones`, `templates`,
`notification_events`, `notification_deliveries`, `import_batches`,
`source_lineage`, `invoice_references` and `audit_logs`.

Use text `CHECK` constraints for the PRD states, `date` for contract dates,
`expiry_version` on circuits/events, unique indexes for active provider codes,
current provider/circuit identifiers, event milestone keys and delivery
idempotency keys. Add indexes for due date/status queries.

- [x] **Step 2: Add profile trigger, helper functions and RLS**

Create an `auth.users` trigger that inserts an inactive `viewer` profile. Add
security-definer helpers for current role and allowed provider scope without
recursively selecting the profiles policy. Enable RLS on every public table.

Policies must permit authenticated read access only within provider scope,
allow writes only to administrators/editors for operational tables, allow
provider managers to update renewal fields on assigned circuits, and expose
audit/delivery sensitive columns only to administrators. No policy permits
update/delete of audit rows or completed delivery history.

- [x] **Step 3: Seed only safe draft provider data**

Insert exactly these providers with unique codes and the PRD's unverified
responsible-officer text:

```sql
NTT       | Muntasim-Ul-Haque
SGIX      | Md. Arifur Rahman
HE        | Md. Arifur Rahman
DE-CIX    | Md. Arifur Rahman
PCCW      | Khondakar Hayat Mahmud
COGENT    | Syed Hassan Shovo
TIS       | H.M. Reza Latif
```

Do not insert expiry dates, recipient addresses, phone numbers, channel
credentials or a fabricated user identity.

- [x] **Step 4: Implement Supabase clients and auth middleware**

The server client must preserve and refresh cookies using `@supabase/ssr`.
Middleware should refresh sessions for all requests, redirect unauthenticated
protected paths to `/login`, and redirect unconfigured deployments to `/setup`
without attempting a database call. API routes must return JSON `401`/`403`
rather than HTML redirects.

- [x] **Step 5: Implement invitation-only login**

Create a client login form with email/password sign-in and sign-out support but
no public registration link. Show configuration and unauthorized-account errors
without exposing Supabase keys. After sign-in, server pages still require an
active profile; an inactive invited user receives a clear access-denied message.

- [x] **Step 6: Run schema/client static checks**

Run:

```powershell
npm run typecheck
npm run lint
```

If the Supabase CLI is available, run `supabase db lint` against the migration;
otherwise inspect the SQL with a PostgreSQL parser or a temporary approved
Supabase project without adding credentials to the repository.

---

## Task 4: Implement authenticated provider, circuit and import APIs

**Files:**
- Create: `lib/data.ts`
- Create: `lib/import/xlsx.ts`
- Create: `app/api/providers/route.ts`
- Create: `app/api/providers/[id]/route.ts`
- Create: `app/api/circuits/route.ts`
- Create: `app/api/circuits/[id]/route.ts`
- Create: `app/api/import/preview/route.ts`
- Create: `app/api/import/commit/route.ts`

**Interfaces:**
- `listProviders(filters): Promise<Provider[]>` and `listCircuits(filters): Promise<Circuit[]>` enforce the current profile scope.
- `parseWorkbook(file: File): Promise<ImportPreview>` rejects files over 5 MB, unsupported extensions and encrypted/invalid workbooks.
- `POST /api/import/preview` returns `{ preview: ImportPreview }` without database writes.
- `POST /api/import/commit` accepts reviewed preview rows and returns `{ batchId, counts, issues }`.
- `POST /api/circuits` rejects missing/invalid provider, expiry-before-start and activation without `verifiedAt`.
- `PATCH /api/circuits/:id` increments `expiry_version`, closes future events and appends renewal history whenever expiry changes.

- [x] **Step 1: Add Zod input schemas and data helpers**

Validate provider code/name, date-only values with strict `YYYY-MM-DD`, role
values, lifecycle/action states, normalized circuit IDs and recipient fields.
Centralize JSON response errors as `{ error: { code, message, fields? } }`.

- [x] **Step 2: Implement provider and circuit list/create/update routes**

Require profile authorization before every query. Allow administrators and
operations editors to create/edit providers and circuits. Allow provider
managers only assigned-circuit renewal/action updates. On activation, require
an expiry date, valid start/expiry ordering, owner, and `verified_at` set by an
authorized user. Write redacted audit rows for each mutation.

- [x] **Step 3: Implement bounded XLSX parsing**

Read the uploaded `File` into an `ArrayBuffer`, reject files larger than 5 MB,
use SheetJS with `cellFormula: false`, inspect Sheet1 for provider sections,
exclude Sheet2 narrative rows from automatic import, and pass row arrays to
`normalizeWorkbookRows`. Return sheet/row lineage and issue codes.

- [x] **Step 4: Implement preview and commit endpoints**

Preview must not use a Supabase write. Commit must require an admin/editor,
create an `import_batches` row with SHA-256 checksum, insert draft providers
and circuits only for durable identifiers, store invoice references separately,
write `source_lineage`, and record the import audit entry. Reject a commit if
the client changes the preview checksum or submits an unrecognized decision.

- [x] **Step 5: Add API tests for authorization and validation**

Mock `requireProfile` and Supabase calls to verify unauthenticated `401`,
out-of-scope `403`, invalid dates `400`, activation without verification `422`,
preview-without-write, invoice-only draft handling, and expiry-version renewal
behavior.

- [x] **Step 6: Run API type/lint/test checks**

Run:

```powershell
npm test -- --run
npm run typecheck
npm run lint
```

Expected: all pure and route tests pass without network credentials.

---

## Task 5: Implement notification engine and channel adapters

**Files:**
- Create: `lib/integrations/email.ts`
- Create: `lib/integrations/whatsapp.ts`
- Create: `lib/integrations/discord.ts`
- Create: `lib/notifications/engine.ts`
- Create: `app/api/cron/expiry-notifications/route.ts`
- Create: `app/api/notifications/[id]/resend/route.ts`
- Create: `app/api/channels/test/route.ts`

**Interfaces:**
- `ChannelAdapter.send(input: ChannelSendInput): Promise<ChannelResult>` returns an external ID or classified error.
- `runExpiryNotificationJob(now?: Date): Promise<JobSummary>` returns counts only, never recipient payloads or secrets.
- `verifyCronRequest(request: Request): boolean` accepts Vercel `Authorization: Bearer ${CRON_SECRET}` only.
- `POST /api/notifications/:id/resend` requires admin/editor reason text and creates a distinct delivery row.
- `POST /api/channels/test` requires an admin and a separately supplied test recipient; it never uses live recipients automatically.

- [x] **Step 1: Write adapter and cron security tests**

Mock `fetch` to verify email payloads include accessible HTML plus plain text,
WhatsApp uses the Graph endpoint/template payload, Discord uses `allowed_mentions`
without `@everyone`/`@here`, and no adapter runs when required configuration is
missing. Test missing/wrong cron secret returns `401` and a valid secret reaches
the job.

- [x] **Step 2: Implement server-only channel adapters**

Email uses `EMAIL_API_URL` (defaulting only to the documented API shape),
`EMAIL_API_KEY`, sender values and resolved To/CC/BCC. WhatsApp calls
`https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`
with the approved template name and only opted-in E.164 targets. Discord posts
an embed to a resolved webhook and sends an explicit allowed mention list.
Never return request headers, API tokens, webhook URLs or BCC values in errors.

- [x] **Step 3: Implement due-event and delivery creation**

Use the service-role Supabase client only inside the cron engine. Query eligible
circuits in bounded pages, calculate due milestones, upsert one event per
`circuit_id/expiry_version/milestone_key`, resolve recipients with the pure
routing module, and upsert independent deliveries using the stable idempotency
key before any external call.

- [x] **Step 4: Implement claiming, dispatch and persistence**

Claim a bounded batch with a conditional status update from `Queued` or
`Retry Scheduled` to `Sending`. Dispatch channels independently. Mark accepted
responses `Sent` with external ID; classify 429/5xx/network failures as retryable
with bounded next-attempt time; classify missing configuration/4xx/invalid
recipient as permanent. Repeated cron invocation must find no duplicate queued
delivery for the same target.

- [x] **Step 5: Implement renewal and manual resend behavior**

When a circuit expiry changes, increment `expiry_version`, insert renewal
history, mark future old-version events cancelled, and let the next job create
the new-version schedule. Manual resend copies the original target/channel,
requires a non-empty reason, creates a new key with a resend suffix, and writes
an audit entry without changing the original delivery.

- [x] **Step 6: Implement secured cron and test routes**

The cron route must be `dynamic = "force-dynamic"`, use the Node runtime, cap
work to a Vercel-safe batch, and return `{ ok, businessDate, counts }` only.
The test route must use a separately submitted target and refuse WhatsApp tests
without opt-in metadata. Both routes must redact provider errors in responses.

- [x] **Step 7: Run notification tests and static checks**

Run:

```powershell
npm test -- --run
npm run typecheck
npm run lint
```

Expected: adapter mocks, cron authorization, date eligibility and idempotency
tests pass. A real provider send is not required for local verification and
must not be attempted without approved credentials.

---

## Task 6: Build the responsive administration UI

**Files:**
- Create: `app/(app)/layout.tsx`
- Create: `app/(app)/dashboard/page.tsx`
- Create: `app/(app)/circuits/page.tsx`
- Create: `app/(app)/circuits/new/page.tsx`
- Create: `app/(app)/circuits/[id]/page.tsx`
- Create: `app/(app)/providers/page.tsx`
- Create: `app/(app)/providers/[id]/page.tsx`
- Create: `app/(app)/imports/page.tsx`
- Create: `app/(app)/notifications/page.tsx`
- Create: `app/(app)/settings/page.tsx`
- Create: `app/(app)/audit/page.tsx`
- Create: `components/status-badge.tsx`
- Create: `components/metric-card.tsx`
- Create: `components/empty-state.tsx`
- Create: `components/circuit-form.tsx`
- Create: `components/import-workflow.tsx`
- Create: `components/resend-dialog.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Every protected page calls `requireProfile` before reading data.
- Forms submit to the authenticated JSON APIs and display field-level errors.
- No page renders webhook URLs, API keys, service keys, full phone numbers or
  unauthorized provider data.

- [x] **Step 1: Add the authenticated application shell**

Create sidebar/header navigation for Dashboard, Circuits, Providers, Imports,
Notifications, Settings and Audit. Show the current user/role, sign-out action,
responsive navigation, and a setup warning when channel/brand/hosting gates are
not configured.

- [x] **Step 2: Build dashboard and registry screens**

Dashboard KPI cards must show Active Circuits, Expiring within four months,
Expiring within 30 days, Missing Expiry Date and Failed Notifications. Add an
upcoming-expiry table grouped by month and a provider exposure summary. Circuit
and provider pages must support search/filter, status labels, owner, expiry and
action status.

- [x] **Step 3: Build circuit create/edit/renewal workflow**

The form must distinguish save Draft from Verify and Activate, display the
calculated first-alert date before activation, validate expiry after start, and
show renewal action status/history. Do not permit an activation submission that
does not include a verified expiry and owner.

- [x] **Step 4: Build import preview/commit workflow**

Upload the workbook, display provider/circuit/invoice counts, show sheet/row
issues, require explicit duplicate decisions, and commit only reviewed data.
Display the data-gap warning that imported rows have no expiry dates and cannot
send notifications.

- [x] **Step 5: Build notifications, settings and audit screens**

Notifications show event/delivery state, channel, masked target, attempt time,
error category and external ID. Add reasoned resend dialog and channel test
forms. Settings show configured/not-configured status without secret values.
Audit is read-only and shows actor, action, entity, timestamp and redacted
before/after summary.

- [x] **Step 6: Run a production build and accessibility-oriented review**

Run:

```powershell
npm run typecheck
npm run lint
npm run build
```

Review rendered pages at desktop and narrow viewport widths for keyboard focus,
semantic labels, non-color-only status, table overflow, and missing-env setup
behavior. No route should require a credential during build.

---

## Task 7: Document deployment and perform final verification

**Files:**
- Modify: `README.md`
- Modify: `.env.example` if the final route/config names require it
- Review: `vercel.json`
- Review: `supabase/migrations/001_initial.sql`
- Review: `supabase/seed.sql`
- Review: all source files for secret-like values

**Interfaces:**
- A new operator can deploy the app to Vercel and Supabase using only the README,
  migration, seed and environment variable names.
- The final verification report identifies exact commands, pass/fail status,
  unavailable external services, and production approval gates.

- [x] **Step 1: Write the deployment runbook**

Document:

1. create a Supabase project and run the migration/seed;
2. invite the first user and activate their profile as administrator;
3. import the workbook and complete current expiry/owner/contact data;
4. create the Vercel project from the repository and add separate preview/
   production environment values;
5. set `CRON_SECRET` and verify the cron route with an authenticated request;
6. configure an approved email provider, Meta template/opt-ins and Discord
   webhook only after organizational approval;
7. supply the official logo asset and approved brand tokens;
8. run channel tests, verify a draft-to-active circuit, inspect audit/delivery
   history, and approve the hosting plan.

Include the exact warning that Vercel Hobby is suitable for technical POC use but
may not be contractually suitable for BSCPLC organizational production use.

- [x] **Step 2: Run repository-wide verification**

Run these exact commands from `D:\upstreamnotify`:

```powershell
npm install
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

Then run a file/configuration check that confirms `vercel.json`,
`.env.example`, the migration, seed and design/plan docs exist, and searches
tracked text for common secret markers without printing environment values.

- [x] **Step 3: Perform a local route smoke check**

Start `npm run dev` in a separate process, request `/setup`, `/login`, and the
cron route without a secret, and confirm:

- `/setup` returns `200` without Supabase credentials;
- `/login` renders without exposing configuration secrets;
- cron without the correct bearer secret returns `401`;
- no local file changes occur as a result of read-only requests.

- [x] **Step 4: Review implementation against the PRD**

Confirm acceptance coverage for date arithmetic, timezone boundary, retry
idempotency, channel independence, provider fallback, renewal versioning,
import invoice/circuit separation, role boundaries, masked recipients, and
production go-live warnings. Record any external-service limitation rather than
claiming a live integration test.

---

## Plan Self-Review

- **Spec coverage:** Tasks 1–3 cover the foundation, pure rules, data model,
  authentication and RLS. Task 4 covers onboarding and CRUD. Task 5 covers
  scheduler, idempotency, retries and all three channels. Task 6 covers every
  MVP screen. Task 7 covers deployment and operational gates.
- **Placeholder scan:** The plan contains no placeholder markers or
  unspecified implementation step. Missing business values are explicitly
  represented as validation/setup gates, not hidden placeholders.
- **Type consistency:** The function names and API payloads introduced in Tasks
  2–5 are the interfaces consumed by later tasks. `expiry_version`,
  `notification_events`, and `notification_deliveries` use the same names in
  the schema, engine and UI.
- **Vercel consistency:** Only one daily cron is configured; no filesystem
  persistence, long-running worker, WebSocket, or unbounded batch is planned.
- **Security consistency:** Public browser configuration is separated from
  service credentials; RLS and server authorization are both required; test and
  resend targets are explicit; secrets are excluded from logs and responses.
- **Scope consistency:** The plan delivers a single testable MVP and records
  post-MVP/approval-only items as explicit gates instead of expanding scope.
