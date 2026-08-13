# BSCPLC Circuit Expiry Notification System

**Date:** 2026-08-03
**Status:** Approved for autonomous MVP implementation
**Source:** approved BSCPLC PRD dated 31 July 2026 (not stored in this repository)
**Deployment target:** Vercel Hobby/free-tier-compatible proof of concept with a managed external database

## 1. Purpose and scope

The system replaces spreadsheet-only upstream circuit tracking with a secure,
auditable web application. It stores providers, durable circuit identifiers,
verified contract dates, owners, notification routing and renewal history. A
daily scheduler evaluates due expiry milestones and records independent delivery
attempts through email, WhatsApp Cloud API and Discord.

This implementation is one coherent MVP rather than an attempt to deliver every
post-MVP item in the PRD. It includes the complete path from onboarding through
notification history:

- invitation-only authentication and server-side role checks;
- provider and circuit registry screens;
- draft/verified lifecycle and renewal status;
- XLSX preview, normalization, validation, duplicate detection and commit;
- source-file lineage for imported records;
- four-calendar-month initial reminders and configurable milestone records;
- daily Asia/Dhaka evaluation through one secured Vercel Cron route;
- idempotent notification events and channel deliveries;
- server-only email, WhatsApp and Discord adapters;
- delivery history, bounded retry state, manual resend reason and audit entries;
- responsive BSCPLC-themed dashboard and administration screens;
- deployment, migration and environment documentation.

The implementation deliberately does not invent missing contract expiry dates,
credentials, recipients, WhatsApp opt-in evidence, approved templates or an
official logo. Imported workbook records remain drafts until an administrator
completes and verifies the required fields.

## 2. Hosting and operational boundary

The application is stateless and Vercel-compatible:

- Next.js route handlers run as bounded Node.js serverless functions.
- Supabase provides Postgres and Auth; no production data is written to the
  Vercel filesystem.
- `vercel.json` declares exactly one daily cron at `03:00 UTC`, approximately
  `09:00 Asia/Dhaka`.
- The cron route authenticates `CRON_SECRET`, batches due work, stores state
  before external calls, and returns a non-sensitive summary.
- External channel credentials are environment variables or encrypted server
  data and never appear in browser payloads.

Vercel Hobby can technically run this proof of concept, but the PRD identifies
Hobby's personal/non-commercial terms as a production risk for BSCPLC. The
README and in-app setup guidance will make production-plan approval a go-live
gate; the implementation will not claim that free hosting is contractually
approved.

## 3. Architecture

### 3.1 Layers

1. **Presentation:** Next.js App Router pages, accessible forms, tables, status
   badges and responsive navigation.
2. **Authorization:** Supabase Auth session refresh in middleware, profile/role
   checks in server code, and Postgres RLS as the final enforcement layer.
3. **Application routes:** authenticated CRUD/import/notification endpoints and
   a separately secret-authenticated cron endpoint.
4. **Domain modules:** date arithmetic, recipient routing precedence, workbook
   normalization, idempotency keys, retry classification and template rendering.
5. **Persistence:** SQL migration containing relational records, append-only
   delivery/audit data, uniqueness constraints and RLS policies.
6. **Integrations:** small server-only `EmailChannel`, `WhatsAppChannel` and
   `DiscordChannel` adapters using `fetch` and environment configuration.

Each layer has a narrow responsibility. Pure domain modules do not import
Supabase or browser APIs, which keeps the highest-risk business rules unit
testable without external services.

### 3.2 Request and notification flow

**Authenticated request:**

1. Middleware refreshes the Supabase session and blocks unauthenticated access
   to application routes.
2. The route creates a server Supabase client from request cookies.
3. The route resolves the profile and role, validates input with Zod, and lets
   RLS enforce the same access boundary in the database.
4. The route writes the entity and an audit row, redacting secrets and private
   channel payloads.

**Daily notification:**

1. Vercel calls `/api/cron/expiry-notifications` with the configured secret.
2. The handler derives one date-only business date in `Asia/Dhaka`.
3. It selects only active/renewal-pending circuits with a verified expiry and
   an enabled rule whose milestone is due.
4. It upserts a notification event and delivery rows before making any external
   request. Unique keys make repeated cron invocations harmless.
5. It claims a bounded batch of queued deliveries, resolves settings in the
   order circuit override → provider setting → global environment default, and
   calls each enabled channel independently.
6. It stores accepted/external message IDs, error categories, retry count and
   timestamps. One channel failure does not suppress another channel.
7. It leaves transient failures retryable and records permanent configuration or
   validation failures for the dashboard.

## 4. Data model

The SQL migration defines these principal tables:

- `profiles`: Supabase user identity, role, active flag and allowed provider IDs.
- `providers`: unique code/name, draft responsible-officer text, active state and
  notes.
- `provider_contacts`: internal/external contact data, E.164 phone and opt-in
  timestamp/source.
- `provider_notification_settings`: provider overrides for recipients,
  templates, channel switches and encrypted webhook/override values.
- `circuits`: durable provider-linked identifier, contract dates, lifecycle,
  renewal action, owner overrides, cost metadata, verification state and
  `expiry_version`.
- `renewal_history`: append-only expiry/action changes and references.
- `notification_rules` and `notification_milestones`: global/provider/circuit
  cadence definitions, including the required four-calendar-month milestone.
- `templates`: global or provider-specific channel templates with version and
  active state.
- `notification_events`: one milestone event per circuit expiry version.
- `notification_deliveries`: one independent channel/target attempt per event,
  with a unique idempotency key, state, retry metadata and external ID.
- `import_batches` and `source_lineage`: checksum, source sheet/row and commit
  status for workbook onboarding.
- `audit_logs`: actor, request ID, action, entity and redacted before/after
  summaries; application code exposes no update/delete operation.

Integrity constraints include:

- active provider codes are unique;
- provider plus normalized durable circuit ID is unique for the current record;
- expiry is date-only and must follow start date when both exist;
- only verified active/renewal-pending circuits are scheduler eligible;
- an event is unique by circuit, expiry version and milestone;
- delivery is unique by event, channel and target hash;
- audit and completed-delivery records are append-only through RLS/application
  policy.

The supplied provider seed is limited to NTT, SGIX, HE, DE-CIX, PCCW, COGENT
and TIS with the workbook's responsible-officer names represented as
unverified draft text. No historical invoice number is promoted to a circuit
ID automatically.

## 5. Authentication and authorization

The UI exposes sign-in only; it does not expose open registration. User
invitations are managed through Supabase Auth or a future administrator invite
route. A database trigger creates an inactive/viewer profile that must be
activated by an administrator.

Roles are:

- **System Administrator:** all application operations, configuration and audit
  visibility;
- **Provider Manager:** assigned provider/circuit access, renewal updates,
  previews and acknowledgements;
- **Operations Editor:** provider/circuit/import edits but no secrets or global
  security changes;
- **Viewer/Auditor:** read-only operational and audit visibility.

Every route checks the authenticated profile and allowed provider scope. RLS
policies repeat this boundary, so a client cannot bypass server checks by
calling Supabase directly. Sensitive values are never selected into ordinary
client responses.

## 6. Import design

The preview endpoint accepts a bounded XLSX upload, validates extension/content
size, reads workbook rows without executing formulas/macros, and returns a
non-persistent preview. It recognizes provider headings and separates:

- durable circuit/link identifiers;
- invoice references;
- optional unambiguous billing metadata;
- ambiguous or unsupported rows requiring manual review.

The commit endpoint accepts only the reviewed preview shape, creates an import
batch, inserts draft providers/circuits/invoice references, and writes source
lineage. It never invents expiry dates or silently converts invoice numbers into
circuit identifiers. Duplicate decisions are explicit: skip, merge, or create
a justified version.

The UI displays actionable missing-data errors for expiry, owner, contact,
channel and verification status. Preview does not write database rows.

## 7. Notification rules and integrations

The required first milestone is calculated by subtracting four calendar months,
with end-of-month handling. For example, 31 August maps to 30 April and leap
year cases are covered by tests. All calculations use UTC date components and
the scheduler's Asia/Dhaka business date, never a browser timezone.

The default optional milestone catalog includes T-90, T-60, T-30, T-14, T-7,
expiry-day and post-expiry options. The scheduler only creates enabled
milestones.

The adapters are intentionally small and replaceable:

- **Email:** approved transactional HTTP API, BSCPLC HTML/plain-text template,
  To/CC/BCC/Reply-To, provider subject prefix and action link.
- **WhatsApp:** official Meta Cloud API only, approved utility template only,
  normalized E.164 recipients with recorded opt-in only.
- **Discord:** incoming webhook with structured embed and explicit allowlisted
  mentions; `@everyone` and `@here` are blocked.

Missing global configuration and invalid provider configuration are permanent
failures with admin-facing guidance. Network errors, rate limits and 5xx
responses are transient and receive bounded retry metadata. Manual resend
creates a new delivery and audit record; it never overwrites the original.

## 8. User interface

The application provides:

- **Dashboard:** active/expiring/missing-data/failed-delivery KPIs, upcoming
  expiry table, provider exposure and configuration alerts.
- **Circuits:** searchable/filterable registry, create/edit/verify workflow,
  detail history and renewal action panel.
- **Providers:** contacts, draft ownership, routing settings and assigned
  circuits.
- **Imports:** XLSX upload, preview issue table, duplicate decisions and commit.
- **Notifications:** event/delivery history, status/error detail, preview and
  reasoned resend.
- **Settings:** organization, users/roles, global rules/templates and channel
  health guidance.
- **Audit:** read-only filtered event history.

The theme uses provisional accessible blue/green/red/gold tokens from the PRD.
`BrandLogo` loads an approved `/bscplc-logo.svg` when supplied and otherwise
renders an explicit text fallback; it does not fabricate or distort an
official-looking logo. Dates are displayed as `31 Jul 2026`, and state is always
represented by text as well as color.

## 9. Environment and deployment

The repository will contain `.env.example` with names only:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`;
- `SUPABASE_SERVICE_ROLE_KEY` for the server-only cron client;
- `CRON_SECRET`, `APP_BASE_URL`, `APP_ENCRYPTION_KEY`;
- `EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`;
- `WHATSAPP_API_VERSION`, `WHATSAPP_ACCESS_TOKEN`,
  `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`;
- `DISCORD_WEBHOOK_URL`.

No secret is committed. Vercel preview and production environments must use
separate values. The README documents Supabase migration/seed, Vercel project
import, environment setup, cron verification and the Hobby production-use
warning.

## 10. Testing and acceptance

Automated tests cover:

- end-of-month and leap-year four-month arithmetic;
- Asia/Dhaka date boundary conversion;
- circuit/provider/global routing precedence;
- stable idempotency key generation;
- workbook classification of durable IDs versus invoice references;
- malformed input and missing required fields.

Build/lint verification covers all Next.js routes and TypeScript. Integration
boundaries are tested with mocked `fetch` behavior where practical and remain
disabled without credentials. A deployment-readiness check confirms:

- `npm run lint`, `npm test -- --run` and `npm run build` pass;
- `vercel.json`, migration, seed and `.env.example` exist;
- no secret-like values are tracked;
- cron route rejects missing/wrong secrets;
- the UI cannot activate a circuit lacking a verified expiry.

## 11. Explicit remaining business gates

The implementation cannot resolve these PRD data/approval gaps autonomously:

- current contract expiry register and renewal dates;
- final responsible-officer confirmation;
- approved BSCPLC logo and brand guide;
- approved sending domain/email provider;
- Meta Business account, approved utility template and opt-in evidence;
- approved Discord destination;
- retention policy and organizational production hosting plan.

Those gates are represented as setup warnings and validation rules rather than
invented defaults. The system is ready for technical deployment and safe data
onboarding, not a claim that organizational production approvals exist.
