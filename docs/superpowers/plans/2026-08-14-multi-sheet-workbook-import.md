# Multi-Sheet Workbook Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private, auditable four-sheet workbook importer that creates trusted active/expired records, safe drafts, searchable alternate identifiers, and deterministic lineage.

**Architecture:** Pure sheet adapters normalize cell grids into one signed preview model. A new additive Supabase migration owns identifiers, metadata, lifecycle invariants, and atomic commit; thin API/UI boundaries validate and review that model without storing raw workbook rows.

**Tech Stack:** TypeScript, SheetJS, Zod, Next.js App Router, Supabase/PostgreSQL PL/pgSQL/RLS, Vitest.

## Global Constraints

- Never copy, commit, fixture, log, or embed the private workbook or its real records.
- Parse only `Upstream (IPT)`, `Upstream (Backhaul)`, `Internet Exchange`, and `Singapore Equinix`.
- Ignore helper `Sheet1` with an informational issue.
- Complete future records are active, verified, notification-enabled, and use `owner_override = "BSCPLC IIG Support"` until individually assigned.
- Complete past records are expired and notification-disabled; incomplete records are drafts and notification-disabled.
- BSCPLC/circuit ID is primary; provider/customer identifiers are searchable alternates with approved fallbacks.
- Permission expiry is authoritative for Internet Exchange.
- Procedure-start dates are stored but scheduling behavior belongs to the notification plan.
- Unknown cells produce warnings; structural/date/identifier conflicts block commit.
- Live preview, commit, and scheduler execution are separate operator gates.

---

## File structure

- Create `lib/domain/workbook-import.ts` and `lib/domain/provider-aliases.ts` for shared pure types/policy.
- Create `lib/import/cell-values.ts`, `dates.ts`, `costs.ts`, and `merge-preview.ts`.
- Create four files under `lib/import/adapters/` plus `types.ts` and `index.ts`.
- Modify `lib/import/xlsx.ts` for multi-sheet orchestration and expiring signed previews.
- Create `supabase/migrations/002_multi_sheet_workbook_import.sql`.
- Modify `lib/validation.ts`, import API routes, and `components/import-workflow.tsx`.
- Modify `lib/data.ts` and circuit detail/list UI for metadata and alternate search.
- Replace legacy importer tests with synthetic adapter/orchestration/migration tests.

### Task 1: Shared import model and parsing utilities

**Files:**
- Create: `lib/domain/workbook-import.ts`
- Create: `lib/domain/provider-aliases.ts`
- Create: `lib/import/cell-values.ts`
- Create: `lib/import/dates.ts`
- Create: `lib/import/costs.ts`
- Test: `tests/workbook-import-model.test.ts`

**Interfaces:**
- Produces: `ImportSource`, `ImportIssue`, `ImportIdentifier`, `CircuitImportCandidate`, `ImportPreview`, `resolveCanonicalProvider`, `parseWorkbookDate`, and `parseImportCost`.

- [ ] **Step 1: Write failing tests for canonical types and pure parsing**

```ts
expect(parseWorkbookDate("15-Sep-30")).toEqual({ value: "2030-09-15" });
expect(parseWorkbookDate("contract continues month wise")).toEqual({ value: null, error: "INVALID_DATE" });
expect(parseImportCost("USD 777")).toEqual({ monthlyCost: 777, currency: "USD", rawDetails: null });
expect(parseImportCost("Committed USD 500; burstable USD 100")).toEqual({
  monthlyCost: null, currency: "USD", rawDetails: "Committed USD 500; burstable USD 100",
});
expect(resolveCanonicalProvider("Example Carrier (Site A)", "Example Carrier"))
  .toEqual({ code: "EXAMPLE_CARRIER", name: "Example Carrier" });
```

- [ ] **Step 2: Run the model test and confirm RED**

Run: `npx vitest run tests/workbook-import-model.test.ts`

Expected: FAIL for missing modules.

- [ ] **Step 3: Define the normalized model**

```ts
export type CircuitImportCandidate = {
  candidateKey: string;
  providerCode: string;
  providerName: string;
  externalCircuitId: string;
  identifierType: "circuit" | "link" | "durable";
  identifiers: ImportIdentifier[];
  serviceType: string | null;
  capacity: string | null;
  location: string | null;
  segment: string | null;
  connectedRouter: string | null;
  startDate: string | null;
  expiryDate: string | null;
  renewalProcedureStartDate: string | null;
  monthlyCost: number | null;
  currency: string | null;
  rawCostDetails: string | null;
  notes: string | null;
  status: "draft" | "active" | "expired";
  notificationEnabled: boolean;
  ownerOverride: string | null;
  sources: ImportSource[];
};
```

Define issue severity as `"info" | "warning" | "error"`; do not carry raw rows.

- [ ] **Step 4: Implement strict parsing and lifecycle policy**

Use explicit accepted date formats, decimal/currency bounds, consumed-cell
tracking, and canonical provider aliases. Classification receives the Dhaka
business date as an argument so tests and previews are deterministic.

- [ ] **Step 5: Run tests and confirm GREEN**

Run: `npx vitest run tests/workbook-import-model.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit shared import policy**

```powershell
git add lib/domain/workbook-import.ts lib/domain/provider-aliases.ts lib/import/cell-values.ts lib/import/dates.ts lib/import/costs.ts tests/workbook-import-model.test.ts
git commit -m "feat: add workbook import model"
```

### Task 2: IP Transit and Backhaul adapters

**Files:**
- Create: `lib/import/adapters/types.ts`
- Create: `lib/import/adapters/upstream-ipt.ts`
- Create: `lib/import/adapters/upstream-backhaul.ts`
- Test: `tests/import-upstream-ipt.test.ts`
- Test: `tests/import-upstream-backhaul.test.ts`

**Interfaces:**
- Produces: `WorkbookSheetAdapter.parse(sheet, businessDate): SheetAdapterResult`.
- Consumes: Task 1 parsing/model helpers.

- [ ] **Step 1: Write synthetic IP Transit tests**

Use invented provider/identifier values to assert explicit provider precedence,
primary circuit ID, metadata/date mapping, compound-cost warning, active support
ownership, and errors for missing IDs/contradictory dates.

- [ ] **Step 2: Write synthetic Backhaul tests**

Assert BSCPLC ID primary, provider ID alternate, provider-ID fallback when
internal ID is blank, canonical heading aliases, and location text not retained
in canonical provider names.

- [ ] **Step 3: Run both tests and confirm RED**

Run: `npx vitest run tests/import-upstream-ipt.test.ts tests/import-upstream-backhaul.test.ts`

Expected: FAIL for missing adapters.

- [ ] **Step 4: Implement the adapter contract and both adapters**

```ts
export interface WorkbookSheetAdapter {
  readonly sheetName: string;
  parse(sheet: WorksheetGrid, businessDate: string): SheetAdapterResult;
}
```

Track consumed columns and emit `UNMAPPED_CELL` warnings for unknown non-empty
cells. Never store the input row on a provider, candidate, or issue.

- [ ] **Step 5: Run adapter tests and confirm GREEN**

Run: `npx vitest run tests/import-upstream-ipt.test.ts tests/import-upstream-backhaul.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the first adapters**

```powershell
git add lib/import/adapters/types.ts lib/import/adapters/upstream-ipt.ts lib/import/adapters/upstream-backhaul.ts tests/import-upstream-ipt.test.ts tests/import-upstream-backhaul.test.ts
git commit -m "feat: parse upstream circuit sheets"
```

### Task 3: Internet Exchange and Equinix adapters

**Files:**
- Create: `lib/import/adapters/internet-exchange.ts`
- Create: `lib/import/adapters/singapore-equinix.ts`
- Create: `lib/import/merge-preview.ts`
- Test: `tests/import-internet-exchange.test.ts`
- Test: `tests/import-singapore-equinix.test.ts`
- Test: `tests/workbook-import-merge.test.ts`

**Interfaces:**
- Produces: normalized Internet Exchange/Equinix results and `mergeAdapterResults(results): ImportPreview`.

- [ ] **Step 1: Write synthetic Internet Exchange tests**

Assert circuit ID primary, customer/link alternate, permission-expiry
precedence, and preservation of deactivation narrative in notes without date
inference.

- [ ] **Step 2: Write synthetic Equinix and merge tests**

Assert service-order primary, later-table enrichment, two lineage entries,
billing-only drafts, continuation-cost enrichment, one service for multiline
values, deterministic provider/identifier dedupe, and blocking conflicting
duplicates.

- [ ] **Step 3: Run tests and confirm RED**

Run: `npx vitest run tests/import-internet-exchange.test.ts tests/import-singapore-equinix.test.ts tests/workbook-import-merge.test.ts`

Expected: FAIL for missing modules.

- [ ] **Step 4: Implement both adapters and deterministic merging**

Group by `${providerCode}:${primary.normalizedValue}`. Merge only compatible
non-null fields, append unique source entries, count deterministic enrichments,
and emit `CONFLICTING_DUPLICATE` for differing non-null critical values.

- [ ] **Step 5: Run tests and confirm GREEN**

Run: `npx vitest run tests/import-internet-exchange.test.ts tests/import-singapore-equinix.test.ts tests/workbook-import-merge.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit remaining adapters**

```powershell
git add lib/import/adapters/internet-exchange.ts lib/import/adapters/singapore-equinix.ts lib/import/merge-preview.ts tests/import-internet-exchange.test.ts tests/import-singapore-equinix.test.ts tests/workbook-import-merge.test.ts
git commit -m "feat: parse exchange service sheets"
```

### Task 4: Multi-sheet workbook orchestration and signed preview expiry

**Files:**
- Create: `lib/import/adapters/index.ts`
- Modify: `lib/import/xlsx.ts`
- Replace/modify: `lib/domain/import-normalizer.ts`
- Test: `tests/xlsx-import.test.ts`

**Interfaces:**
- Produces: `parseWorkbook(file, now?): Promise<WorkbookPreview>`, `verifyPreviewSignature(...)`, and `isPreviewFresh(issuedAt, now)`.
- Consumes: Tasks 1–3 adapters/model.

- [ ] **Step 1: Create failing in-memory workbook tests**

Build synthetic SheetJS workbooks in memory with four recognized sheets,
helper `Sheet1`, an unknown non-empty sheet, and no private values. Assert exact
dispatch, info/warning issues, all adapter outputs, checksum/signature coverage,
and rejection after a fixed 30-minute preview lifetime.

- [ ] **Step 2: Run tests and confirm RED**

Run: `npx vitest run tests/xlsx-import.test.ts`

Expected: FAIL because only the first sheet is parsed.

- [ ] **Step 3: Implement the exact adapter registry and orchestration**

```ts
export const WORKBOOK_SHEET_ADAPTERS = new Map<string, WorkbookSheetAdapter>([
  [upstreamIpt.sheetName, upstreamIpt],
  [upstreamBackhaul.sheetName, upstreamBackhaul],
  [internetExchange.sheetName, internetExchange],
  [singaporeEquinix.sheetName, singaporeEquinix],
]);
```

Sign filename, sheet names, file checksum, preview checksum, and
`previewIssuedAt`. Keep legacy exports temporarily only where existing callers
still require them.

- [ ] **Step 4: Run orchestration and legacy tests**

Run: `npx vitest run tests/xlsx-import.test.ts tests/import-normalizer.test.ts`

Expected: PASS after migrating/removing obsolete legacy expectations.

- [ ] **Step 5: Commit workbook orchestration**

```powershell
git add lib/import/adapters/index.ts lib/import/xlsx.ts lib/domain/import-normalizer.ts tests/xlsx-import.test.ts tests/import-normalizer.test.ts
git commit -m "feat: orchestrate multi-sheet previews"
```

### Task 5: Additive schema and identifier migration

**Files:**
- Create: `supabase/migrations/002_multi_sheet_workbook_import.sql`
- Create: `tests/migration-002.test.ts`
- Modify: `tests/schema.test.ts`

**Interfaces:**
- Produces: new circuit columns, `circuit_identifiers`, backfill, RLS, indexes, and an updated `commit_import_batch` with its existing SQL signature.

- [ ] **Step 1: Write failing migration artifact tests**

Assert additive columns, renewal-date constraint, one-primary-per-circuit index,
normalized search index, backfill from existing circuits, parent-provider RLS,
service-role-only commit RPC, actor-derived verification, support owner override,
multiple lineage inserts, and no raw preview rows in audit JSON.

- [ ] **Step 2: Run migration tests and confirm RED**

Run: `npx vitest run tests/migration-002.test.ts tests/schema.test.ts`

Expected: FAIL because migration 002 does not exist.

- [ ] **Step 3: Implement additive columns and identifier relation**

```sql
alter table public.circuits
  add column if not exists renewal_procedure_start_date date,
  add column if not exists segment text,
  add column if not exists connected_router text,
  add column if not exists raw_cost_details text;

create table if not exists public.circuit_identifiers (
  id uuid primary key default gen_random_uuid(),
  circuit_id uuid not null references public.circuits(id) on delete cascade,
  identifier_kind text not null,
  original_value text not null,
  normalized_value text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);
```

Add primary/uniqueness/search indexes, backfill all existing circuits, and RLS
through parent-circuit provider access.

- [ ] **Step 4: Replace the commit RPC atomically**

Keep its argument signature. Validate actor role, derive `verified_by` and
`verified_at`, enforce support ownership for active imports, insert all
identifiers and source entries, and preserve sanitized rejected-batch behavior.

- [ ] **Step 5: Run migration tests and optional database lint**

Run: `npx vitest run tests/migration-002.test.ts tests/schema.test.ts`

If Supabase CLI is available, also run: `npx supabase db lint`

Expected: PASS; optional lint reports no SQL errors.

- [ ] **Step 6: Commit migration**

```powershell
git add supabase/migrations/002_multi_sheet_workbook_import.sql tests/migration-002.test.ts tests/schema.test.ts
git commit -m "feat: add multi-sheet import schema"
```

### Task 6: Commit validation and API contract

**Files:**
- Modify: `lib/validation.ts`
- Modify: `app/api/import/commit/route.ts`
- Modify: `app/api/import/preview/route.ts`
- Modify: `tests/import-commit.test.ts`
- Modify: `tests/api-routes.test.ts`

**Interfaces:**
- Consumes: signed `WorkbookPreview` and migration 002 RPC.
- Produces: validated preview/commit responses with lifecycle summary counts.

- [ ] **Step 1: Write failing schema/route tests**

Assert exactly one primary identifier, `externalCircuitId` equality to primary,
unique normalized alternates, date order, owner/lifecycle consistency, summary
consistency, `severity === "error"` commit blocking, 30-minute expiry, canonical
decision keys, and response allowlisting.

- [ ] **Step 2: Run tests and confirm RED**

Run: `npx vitest run tests/import-commit.test.ts tests/api-routes.test.ts`

Expected: FAIL against the legacy shape.

- [ ] **Step 3: Implement Zod schemas and route validation**

Infer TypeScript payload types from Zod where practical. Reject blocking issues
before RPC invocation. Update approved count keys in lockstep with SQL and UI;
do not return nested preview data from commit.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `npx vitest run tests/import-commit.test.ts tests/api-routes.test.ts tests/xlsx-import.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit API contract**

```powershell
git add lib/validation.ts app/api/import/commit/route.ts app/api/import/preview/route.ts tests/import-commit.test.ts tests/api-routes.test.ts
git commit -m "feat: validate multi-sheet import commits"
```

### Task 7: Import review UI and alternate identifier search

**Files:**
- Modify: `components/import-workflow.tsx`
- Modify: `lib/data.ts`
- Modify: `app/(app)/circuits/page.tsx`
- Modify: `app/(app)/circuits/[id]/page.tsx`
- Modify: `app/api/circuits/route.ts`
- Modify: `app/api/circuits/[id]/route.ts`
- Modify: `components/circuit-form.tsx`
- Test: `tests/import-workflow-contract.test.ts`
- Test: `tests/data-access.test.ts`
- Modify: `tests/api-routes.test.ts`

**Interfaces:**
- Consumes: shared preview types and `circuit_identifiers`.
- Produces: severity-aware review, disabled invalid commit, metadata display/edit, and primary/alternate search.

- [ ] **Step 1: Write failing UI/data contract tests**

Assert no duplicated local preview type, info/warning/error groups, commit disabled
when errors exist, active/expired/draft/merged counts, identifiers/dates shown,
circuit create/update mapping for the procedure date and metadata, and circuit
search matching either primary or alternate identifier under RLS.

- [ ] **Step 2: Run tests and confirm RED**

Run: `npx vitest run tests/import-workflow-contract.test.ts tests/data-access.test.ts tests/api-routes.test.ts`

Expected: FAIL for the legacy UI/search.

- [ ] **Step 3: Implement review and registry compatibility**

Import shared types, display normalized fields and lineage without raw rows, and
require explicit duplicate decisions. Extend `CircuitRecord`, detail/form fields,
the circuit POST/PATCH mappings, and a database-backed alternate-identifier
search path that retains provider scope and pagination.

- [ ] **Step 4: Run focused tests, typecheck, and build**

Run: `npx vitest run tests/import-workflow-contract.test.ts tests/data-access.test.ts tests/api-routes.test.ts && npm run typecheck && npm run build`

Expected: PASS.

- [ ] **Step 5: Commit review/search behavior**

```powershell
git add components/import-workflow.tsx lib/data.ts "app/(app)/circuits/page.tsx" "app/(app)/circuits/[id]/page.tsx" app/api/circuits/route.ts "app/api/circuits/[id]/route.ts" components/circuit-form.tsx tests/import-workflow-contract.test.ts tests/data-access.test.ts tests/api-routes.test.ts
git commit -m "feat: review imported service metadata"
```

### Task 8: Import documentation and controlled production preview

**Files:**
- Modify: `docs/workbook-format.md`
- Modify: `README.md`

**Interfaces:**
- Produces: migration order, privacy policy, preview acceptance, and explicit commit gate.

- [ ] **Step 1: Replace obsolete first-sheet documentation**

Document four recognized sheets, helper exclusion, primary/alternate rules,
lifecycle/ownership, error severity, synthetic-test privacy, and migration order:

```powershell
node --env-file=.env.local scripts/apply-sql.mjs supabase/migrations/001_initial.sql supabase/migrations/002_multi_sheet_workbook_import.sql supabase/seed.sql
```

Production applies migration 002 only after a database backup/preflight.

- [ ] **Step 2: Run the full repository gate**

Run: `npm test -- --run && npm run typecheck && npm run lint && npm run build`

Expected: PASS.

- [ ] **Step 3: Commit documentation**

```powershell
git add docs/workbook-format.md README.md
git commit -m "docs: add multi-sheet import runbook"
```

- [ ] **Step 4: Apply migration 002 and verify invariants**

Run only after deployment review:

```powershell
node --env-file=.env.local scripts/apply-sql.mjs supabase/migrations/002_multi_sheet_workbook_import.sql
```

Verify backfill count, one primary identifier per existing circuit, constraints,
RLS, and service-role RPC grants.

- [ ] **Step 5: Preview the private workbook without committing**

Use the authenticated production UI. Confirm approximately 9 providers, 23
unique records, 20 active, 3 drafts, and 1 merge. Any material discrepancy or
error-severity issue stops work. Obtain separate operator confirmation before
calling commit.
