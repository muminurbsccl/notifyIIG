import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/002_multi_sheet_workbook_import.sql", "utf8");

describe("multi-sheet workbook import migration", () => {
  it("adds circuit metadata and strict renewal chronology", () => {
    expect(migration).toMatch(/alter table public\.circuits[\s\S]*add column if not exists renewal_procedure_start_date date[\s\S]*add column if not exists segment text[\s\S]*add column if not exists connected_router text[\s\S]*add column if not exists raw_cost_details text/);
    expect(migration).toContain("renewal_procedure_start_date <= expiry_date");
  });

  it("creates searchable identifiers, one primary, backfill, and parent RLS", () => {
    expect(migration).toContain("create table if not exists public.circuit_identifiers");
    expect(migration).toContain("references public.circuits(id) on delete cascade");
    expect(migration).toMatch(/create unique index if not exists circuit_identifiers_unique_value_idx[\s\S]*\(circuit_id, normalized_value\)/);
    expect(migration).toMatch(/create unique index if not exists circuit_identifiers_one_primary_idx[\s\S]*where is_primary/);
    expect(migration).toContain("create constraint trigger circuit_identifiers_require_primary");
    expect(migration).toContain("normalized_value = public.normalize_import_identifier(original_value)");
    expect(migration).toContain("old.circuit_id is distinct from new.circuit_id");
    expect(migration).toContain("Primary identifier must match circuit compatibility values");
    expect(migration).toMatch(/ci\.original_value is distinct from c\.external_circuit_id[\s\S]*ci\.normalized_value is distinct from c\.normalized_circuit_id/);
    expect(migration).toMatch(/create index if not exists circuit_identifiers_normalized_search_idx[\s\S]*normalized_value/);
    expect(migration).toMatch(/insert into public\.circuit_identifiers[\s\S]*from public\.circuits/);
    expect(migration).toMatch(/case when identifier_type = 'durable' then 'alternate'/);
    expect(migration).toContain("alter table public.circuit_identifiers enable row level security");
    expect(migration).toMatch(/create policy circuit_identifiers_select_scope[\s\S]*public\.has_provider_access\(c\.provider_id\)/);
    expect(migration).toMatch(/create policy circuit_identifiers_write_scope[\s\S]*public\.is_admin_or_editor\(\)[\s\S]*public\.has_provider_access\(c\.provider_id\)/);
  });

  it("replaces the RPC with actor-derived lifecycle and all normalized fields", () => {
    expect(migration).toMatch(/create or replace function public\.commit_import_batch\(\s*p_actor_user_id uuid,\s*p_filename text,\s*p_checksum text,\s*p_sheet_names jsonb,\s*p_preview jsonb,\s*p_decisions jsonb default '\{\}'::jsonb/);
    expect(migration).toContain("security definer set search_path = public, pg_temp");
    expect(migration).toContain("actor_role is null or actor_role not in ('admin', 'operations_editor')");
    expect(migration).toContain("verified_by");
    expect(migration).toContain("p_actor_user_id");
    expect(migration).toContain("timezone('utc', now())");
    expect(migration).toContain("BSCPLC IIG Support");
    expect(migration).toContain("timezone('Asia/Dhaka', now())::date");
    expect(migration).toContain("Imported lifecycle does not match database-derived lifecycle");
    expect(migration).toContain("Imported notification or ownership state does not match lifecycle");
    expect(migration).toContain("public.normalize_import_identifier");
    expect(migration).toContain("Imported identifier normalization is invalid");
    expect(migration).toContain("external_circuit_id = imported_external_id");
    expect(migration).toContain("identifier_type = item->>'identifierType'");
    expect(migration).toContain("coalesce(imported_expiry_date, expiry_date) is distinct from expiry_date");
    expect(migration).toMatch(/values \(provider_item->>'code', provider_item->>'name', false\)/);
    expect(migration).not.toMatch(/update public\.providers[\s\S]{0,120}active = true/);
    for (const field of ["serviceType", "capacity", "location", "segment", "connectedRouter", "startDate", "expiryDate", "renewalProcedureStartDate", "monthlyCost", "currency", "rawCostDetails", "notes"]) {
      expect(migration).toContain(`item->>'${field}'`);
    }
  });

  it("writes all identifiers and lineage without persisting raw preview rows in audit", () => {
    expect(migration).toMatch(/jsonb_array_elements\(coalesce\(item->'identifiers'/);
    expect(migration).toMatch(/jsonb_array_elements\(coalesce\(item->'sources'/);
    expect(migration).toMatch(/jsonb_array_elements\(coalesce\(provider_item->'sources'/);
    expect(migration).toContain("insert into public.circuit_identifiers");
    expect(migration).toContain("insert into public.source_lineage");
    expect(migration).not.toContain("p_preview->'summary'");
    expect(migration).toContain("'providerCount'");
    expect(migration).toContain("'serviceCount'");
    const auditInsert = migration.slice(migration.indexOf("insert into public.audit_logs"), migration.indexOf("return jsonb_build_object", migration.indexOf("insert into public.audit_logs")));
    expect(auditInsert).not.toContain("p_preview");
    expect(migration).toContain("preview_summary = jsonb_build_object('status', 'rejected', 'errorCode', 'IMPORT_COMMIT_FAILED')");
  });

  it("keeps commit execution service-role only", () => {
    const signature = "public.commit_import_batch(uuid, text, text, jsonb, jsonb, jsonb)";
    expect(migration).toContain(`revoke all on function ${signature} from public`);
    expect(migration).toContain(`revoke all on function ${signature} from authenticated`);
    expect(migration).toContain(`grant execute on function ${signature} to service_role`);
  });

  it("serializes checksum replays and returns the prior committed result", () => {
    expect(migration).toContain("import_batches_committed_checksum_idx");
    expect(migration).toContain("add column if not exists idempotency_checksum text");
    expect(migration).toMatch(/row_number\(\) over \(partition by checksum order by committed_at desc nulls last, created_at desc, id desc\)/);
    expect(migration).toContain("idempotency_checksum = p_checksum");
    expect(migration).toMatch(/pg_catalog\.pg_advisory_xact_lock\(hashtextextended\('import:' \|\| p_checksum/);
    expect(migration).toContain("where checksum = p_checksum and status = 'committed'");
    expect(migration).toContain("return jsonb_build_object('batchId', prior_batch_id, 'counts', prior_counts)");
  });
});
