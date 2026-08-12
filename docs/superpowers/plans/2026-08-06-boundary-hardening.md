# Task 4 Boundary Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan one task at a time. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the independent Task 4 review findings without weakening the approved provider, circuit, import, RLS, audit, or provenance contracts.

**Architecture:** Keep lifecycle and authorization invariants in the Supabase migration, keep workbook normalization and signature construction in pure/server-only TypeScript helpers, and keep audit insertion behind a server-only service RPC. Existing API routes remain thin authenticated boundaries; they must not become the source of truth for database invariants.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase/PostgreSQL PL/pgSQL, Zod, SheetJS, Vitest, ESLint, TypeScript compiler.

## Global Constraints

- The repository is not a Git repository; preserve existing files and do not initialize Git or commit.
- No Supabase credentials are available; verify SQL through static tests and review only.
- Never invent expiry dates or promote invoice identifiers into circuit identifiers.
- Active providers require either an active primary owner or a nonblank responsible-officer override.
- Active and renewal-pending circuits require verified expiry data and either an active user owner or a nonblank owner override.
- Profile deletion is forbidden; deactivation must not orphan an active circuit owner, backup owner, or verifier.
- `SECURITY DEFINER` functions must use `search_path = public, pg_temp`.
- Do not expose service-role credentials or raw workbook rows to browser responses.
- Preserve the existing worker model/configuration; if the free worker is unavailable, continue transparently in the primary session.

---

### Task 1: Add regression assertions for the review findings

**Files:**
- Modify: `tests/schema.test.ts`
- Modify: `tests/import-commit.test.ts`
- Modify: `tests/auth-boundaries.test.ts`
- Test: the three files above

**Interfaces:**
- Tests inspect the migration text and route/helper behavior already used by the repository.
- Later tasks must make these assertions pass without removing existing security assertions.

- [ ] **Step 1: Add failing migration assertions**

Assert that the migration contains:

```ts
expect(migration).toContain("create or replace function public.validate_provider_state");
expect(migration).toContain("backup_owner_user_id = old.id");
expect(migration).toContain("create trigger providers_validate_state");
expect(migration).toContain("normalized_circuit_id");
expect(migration).toContain("resolve_import_provider");
expect(migration).toContain("revoke all on table public.audit_logs from authenticated");
expect(migration).toContain("create or replace function public.append_audit_log");
```

Add assertions that current import resolution uses explicit code-first/name-second branches and that duplicate invoice lineage is retained.

- [ ] **Step 2: Add failing route/helper assertions**

Extend `tests/import-commit.test.ts` so a successful mocked RPC response with extra nested count fields is rejected, and update the success fixture to contain every required count key.

Add a signature test or helper assertion proving filename and sheet names are included in the signed message. Keep the existing checksum/signature mismatch behavior covered.

- [ ] **Step 3: Run the focused tests and record the expected failures**

Run:

```powershell
npm test -- --run tests/schema.test.ts tests/import-commit.test.ts tests/auth-boundaries.test.ts
```

Expected: failures identify only the newly asserted hardening behavior.

---

### Task 2: Enforce provider, circuit, and profile invariants in SQL

**Files:**
- Modify: `supabase/migrations/001_initial.sql`
- Test: `tests/schema.test.ts`

**Interfaces:**
- Add `public.validate_provider_state()` as a `SECURITY DEFINER` trigger function.
- Extend `public.validate_circuit_state()` to canonicalize/check normalized IDs and validate backup owners.
- Extend `public.prevent_profile_circuit_invariants()` to cover `backup_owner_user_id` and reject DELETE before any lock/query.

- [ ] **Step 1: Add provider validation function and trigger**

Create a trigger function with `search_path = public, pg_temp` that:

```sql
if new.active and nullif(btrim(new.default_responsible_officer), '') is null
   and new.primary_owner_user_id is null then
  raise exception 'Active providers require a responsible owner';
end if;
if new.primary_owner_user_id is not null
   and not exists (select 1 from public.profiles where id = new.primary_owner_user_id and active) then
  raise exception 'Provider owner must be an active user';
end if;
if new.backup_owner_user_id is not null
   and not exists (select 1 from public.profiles where id = new.backup_owner_user_id and active) then
  raise exception 'Provider backup owner must be an active user';
end if;
return new;
```

Install it as `before insert or update` on `public.providers`.

- [ ] **Step 2: Enforce canonical circuit normalization**

In `validate_circuit_state`, derive the canonical identifier with the same trim/uppercase/internal-whitespace rule used by TypeScript. Reject a noncanonical value unless it is a controlled versioned import identifier with the expected `#V` suffix. Do not alter the approved versioned-import behavior or allow arbitrary direct writes to bypass the current-record uniqueness index.

- [ ] **Step 3: Validate backup owners and profile deactivation**

For active/renewal-pending circuits, require any non-null `backup_owner_user_id` to reference an active profile. In the profile deactivation query, include `backup_owner_user_id = old.id` alongside owner and verifier references. Keep DELETE as the first branch so it fails immediately with `Profiles cannot be deleted; deactivate the account instead`.

- [ ] **Step 4: Run focused migration tests**

Run:

```powershell
npm test -- --run tests/schema.test.ts tests/auth-boundaries.test.ts
```

Expected: all migration assertions pass.

---

### Task 3: Make import provider resolution deterministic and normalization-consistent

**Files:**
- Modify: `supabase/migrations/001_initial.sql`
- Modify: `lib/domain/import-normalizer.ts`
- Modify: `app/api/import/commit/route.ts`
- Test: `tests/import-normalizer.test.ts`, `tests/schema.test.ts`, `tests/import-commit.test.ts`

**Interfaces:**
- Add `public.resolve_import_provider(p_code text, p_name text) returns uuid` with code-first, unique-name-second behavior.
- Use the same canonical circuit identifier normalization in preview, route decision-key validation, and SQL commit decision lookup.

- [ ] **Step 1: Add a failing duplicate/whitespace normalizer test**

Add two rows for the same provider and identifier with different internal whitespace and assert that the second candidate is marked as a duplicate with a decision key based on the canonical identifier.

- [ ] **Step 2: Implement the pure normalizer change**

Use the canonical rule `trim → uppercase → collapse whitespace` when building `seenCircuits` and `decisionKey`; preserve the original identifier in the candidate and lineage fields.

- [ ] **Step 3: Add the SQL resolver**

Implement code-first matching. If no code matches, count case-insensitive name matches; return the single match, create a new provider only when the import provider row is genuinely new, and raise a clear exception for ambiguous names. Remove unordered `OR ... LIMIT 1` provider lookups from provider, circuit, and invoice import loops.

- [ ] **Step 4: Align route decision-key validation and SQL lookup**

Use the canonical identifier in both `candidateKeys` and the SQL `p_decisions` lookup. Preserve rejection of unknown decisions and require explicit decisions for preview duplicates.

- [ ] **Step 5: Run focused import tests**

Run:

```powershell
npm test -- --run tests/import-normalizer.test.ts tests/import-commit.test.ts tests/schema.test.ts
```

Expected: all import tests pass, including invoice-only behavior and duplicate lineage behavior.

---

### Task 4: Move audit insertion behind a server-only append boundary

**Files:**
- Modify: `supabase/migrations/001_initial.sql`
- Modify: `lib/audit.ts`
- Modify: `tests/schema.test.ts`

**Interfaces:**
- Add `public.append_audit_log(p_actor_user_id uuid, p_action text, p_entity_type text, p_entity_id uuid, p_before_json jsonb, p_after_json jsonb, p_request_id text) returns void`.
- Grant execute on that function only to `service_role`.
- `writeAudit()` calls the service-role RPC and retains TypeScript redaction before transmission.

- [ ] **Step 1: Add failing audit boundary assertions**

Assert that authenticated users have no direct audit insert policy, the append function is `SECURITY DEFINER` with pinned search path, and only `service_role` receives execute permission.

- [ ] **Step 2: Implement the append function and policy removal**

Validate a non-null active actor inside the function, insert the redacted payload through the existing sanitizing trigger, revoke public/authenticated execution and direct table insert access, and grant only the service role function execution.

- [ ] **Step 3: Update `writeAudit()`**

Use `createServiceSupabaseClient().rpc("append_audit_log", ...)`. Continue passing the authenticated actor ID from the route and preserve the existing redaction function. Do not accept raw secrets or service credentials from request data.

- [ ] **Step 4: Run audit and route tests**

Run:

```powershell
npm test -- --run tests/schema.test.ts tests/api-routes.test.ts tests/import-commit.test.ts
```

Expected: audit boundary assertions and mocked API tests pass.

---

### Task 5: Bind and strictly validate import preview integrity

**Files:**
- Modify: `lib/import/xlsx.ts`
- Modify: `app/api/import/commit/route.ts`
- Modify: `tests/import-commit.test.ts`

**Interfaces:**
- Extend `computePreviewSignature(previewChecksum, fileChecksum, filename, sheetNames)` and its verifier with the same arguments.
- Successful commit counts contain exactly the approved non-negative integer keys: `createdCircuits`, `skippedCircuits`, `mergedCircuits`, `versionedCircuits`, and `invoiceCount`.

- [ ] **Step 1: Add failing signature and count-shape tests**

Assert that changing filename or sheet names invalidates the signature and that nested/unknown count keys cause a safe invalid-result error rather than being returned.

- [ ] **Step 2: Bind metadata in the HMAC**

Sign a stable message containing file checksum, preview checksum, filename, and a deterministic JSON representation of sheet names. Verify the same message during commit and update `parseWorkbook` to sign the metadata it returns.

- [ ] **Step 3: Strictly validate RPC counts**

Require exactly the five approved keys and validate each value as a finite non-negative integer before returning the response. Keep the response allowlist limited to `batchId`, `counts`, and `issues`.

- [ ] **Step 4: Run focused route/import tests**

Run:

```powershell
npm test -- --run tests/import-commit.test.ts tests/import-normalizer.test.ts tests/api-routes.test.ts
```

Expected: all focused tests pass.

---

### Task 6: Full verification and independent review

**Files:**
- Verify all files changed above.
- Update: `.superpowers/sdd/circuit-expiry-notification-system/progress.md` only after all checks pass.

- [ ] **Step 1: Run the complete verification set**

Run exactly:

```powershell
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

- [ ] **Step 2: Review the SQL statically**

Confirm no unauthenticated direct audit insert path, no unordered provider resolution remains in the import RPC, no service-role key reaches client modules, and all `SECURITY DEFINER` functions pin `search_path`.

- [ ] **Step 3: Request an independent review**

Ask a read-only reviewer to inspect the changed migration, helpers, routes, and tests. Resolve all Critical/Important findings before marking Task 4 ready.

- [ ] **Step 4: Record evidence**

Record command results, the unavailable live Supabase verification, the legacy-NULL `import_batches.created_by` migration caveat, and any remaining risks in the SDD progress ledger.
