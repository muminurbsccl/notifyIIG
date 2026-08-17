import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { redactAuditValue } from "@/lib/domain/audit-redaction";

const migration = readFileSync("supabase/migrations/001_initial.sql", "utf8");
const importMigration = readFileSync("supabase/migrations/002_multi_sheet_workbook_import.sql", "utf8");
const migration003 = readFileSync("supabase/migrations/003_notification_production_completion.sql", "utf8");
const seed = readFileSync("supabase/seed.sql", "utf8");

describe("Supabase security and deployment artifacts", () => {
  it("contains provider-scoped default-deny policies and immutable delivery paths", () => {
    expect(migration).toContain("alter table public.audit_logs enable row level security");
    expect(migration).toContain("provider_id is not null and public.has_provider_access(provider_id)");
    expect(migration).toMatch(/create policy invoice_select_scope[\s\S]*provider_id is not null and public\.has_provider_access\(provider_id\)/);
    expect(migration).toContain("Audit append requires an actor");
    expect(migration).not.toContain("create policy deliveries_update_admin");
    expect(migration).toContain("drop policy if exists %I on public.%I");
  });

  it("keeps import commits and circuit lifecycle invariants database-owned", () => {
    const functionStart = migration.indexOf("create or replace function public.commit_import_batch");
    const duplicateSelect = migration.indexOf("select id into existing_id", functionStart);
    const duplicateDecision = migration.indexOf("if existing_id is not null and decision is null", functionStart);
    const importTableStart = migration.indexOf("create table if not exists public.import_batches");
    const importTableEnd = migration.indexOf("create table if not exists public.invoice_references", importTableStart);
    const importTable = migration.slice(importTableStart, importTableEnd);

    expect(migration).toMatch(/create or replace function public\.commit_import_batch\(\s*p_actor_user_id uuid,/);
    expect(migration).toContain("insert into public.import_batches");
    expect(migration).toContain("grant execute on function public.commit_import_batch(uuid, text, text, jsonb, jsonb, jsonb) to service_role");
    expect(migration).not.toContain("grant execute on function public.commit_import_batch(uuid, text, text, jsonb, jsonb, jsonb) to authenticated");
    expect(migration).not.toContain("create policy renewal_insert_operational_scope");
    expect(migration).toContain("create trigger circuits_validate_state before insert or update or delete on public.circuits");
    expect(migration).toContain("Expiry version must increase when expiry date changes");
    expect(migration).toContain("status in ('pending', 'processing')");
    expect(migration).toContain("with ordinality");
    expect(migration).toContain("candidate_number");
    expect(migration).toContain("new.verified_by is null");
    expect(migration).toMatch(/old\.verified_at is not null and new\.verified_at < old\.verified_at/);
    expect(migration).toContain("from public.profiles where id = new.verified_by and active");
    expect(migration).toContain("security definer set search_path = public, pg_temp");
    expect(migration).toContain("Verification timestamp cannot move backwards");
    expect(migration).toContain("Verification cannot be cleared");
    expect(migration).toContain("Expiry version can only change when expiry date changes");
    expect(migration).toContain("create trigger profiles_protect_circuit_invariants before update or delete on public.profiles");
    expect(migration).toContain("where owner_user_id = old.id or verified_by = old.id or backup_owner_user_id = old.id");
    expect(migration).toContain("Profiles cannot be deleted; deactivate the account instead");
    expect(migration).toContain("owner_user_id uuid references public.profiles(id) on delete restrict");
    expect(migration).toContain("verified_by uuid references public.profiles(id) on delete restrict");
    expect(migration).toContain("replace(batch_id::text, '-', '')");
    expect((migration.match(/pg_catalog\.pg_advisory_xact_lock\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("create trigger circuits_validate_state before insert or update or delete on public.circuits");
    expect(migration).toContain("where id = target_circuit_id and public.has_provider_access(provider_id)");
    expect(migration).toContain("actor_role is null or actor_role not in");
    expect(importTable).toContain("created_by uuid not null references public.profiles(id)");
    expect(migration).toContain("tablename = any (array[");
    expect(migration).not.toContain("policyname = any (array[");
    expect(migration).toContain("if invoice_id is null then");
    expect(migration).toContain("create or replace function public.validate_provider_state");
    expect(migration).toContain("create trigger providers_validate_state before insert or update on public.providers");
    expect(migration).toContain("new.backup_owner_user_id");
    expect(migration).toContain("backup_owner_user_id = old.id");
    expect(migration).toContain("resolve_import_provider");
    expect(migration).toContain("create or replace function public.append_audit_log");
    expect(migration).toContain("revoke all on table public.audit_logs from authenticated");
    expect(migration).not.toContain("create policy audit_insert_active_actor");
    expect(migration).toContain("upper(regexp_replace(regexp_replace(new.external_circuit_id");
    expect(migration).toContain("Imported circuit provider could not be resolved");
    expect(migration).toContain("Skip or merge requires an existing circuit");
    expect((migration.match(/upper\(regexp_replace\(regexp_replace\(item->>'externalCircuitId'/g) ?? []).length).toBe(1);
    expect(migration).not.toContain("create policy invoice_write_admin_editor");
    expect(migration).toContain("drop function if exists public.commit_import_batch(uuid, uuid, text, text, jsonb, jsonb, jsonb)");
    expect(migration).toContain("values ('provider', target_provider_id");
    expect(duplicateSelect).toBeGreaterThan(functionStart);
    expect(duplicateSelect).toBeLessThan(duplicateDecision);
  });

  it("extends import security without weakening the initial policies", () => {
    expect(importMigration).toContain("alter table public.circuit_identifiers enable row level security");
    expect(importMigration).toContain("create policy circuit_identifiers_select_scope");
    expect(importMigration).toContain("create policy circuit_identifiers_write_scope");
    expect(importMigration).not.toContain("grant execute on function public.commit_import_batch(uuid, text, text, jsonb, jsonb, jsonb) to authenticated");
    expect(importMigration).toContain("grant execute on function public.commit_import_batch(uuid, text, text, jsonb, jsonb, jsonb) to service_role");
  });

  it("keeps the safe seed free of contract and recipient data", () => {
    expect(seed).toContain("('DE-CIX', 'DE-CIX'");
    expect(seed).toContain("'global-default'");
    expect(seed).not.toMatch(/expiry_date|phone_e164|email_to|webhook/i);
  });

  it("includes production completion schedule and claim primitives", () => {
    expect(migration003).toContain("create table if not exists public.notification_milestone_states");
    expect(migration003).toContain("alter table public.notification_events\n  add column if not exists is_catch_up boolean not null default false;");
    expect(migration003).toContain("create or replace function public.ensure_due_notification_events(");
    expect(migration003).toContain("create or replace function public.claim_notification_deliveries(");
    expect(migration003).toContain("for update skip locked");
    expect(migration003).toContain("grant execute on function public.ensure_due_notification_events(");
    expect(migration003).toContain("grant execute on function public.claim_notification_deliveries(integer) to service_role;");
  });

  it("redacts nested audit secret names, including generic key variants", () => {
    expect(
      redactAuditValue({
        apiKey: "secret",
        serviceRoleKey: "secret",
        encryptionKey: "secret",
        nested: [{ webhook: "secret", visible: "kept" }],
      }),
    ).toEqual({
      apiKey: "[REDACTED]",
      serviceRoleKey: "[REDACTED]",
      encryptionKey: "[REDACTED]",
      nested: [{ webhook: "[REDACTED]", visible: "kept" }],
    });
  });
});
