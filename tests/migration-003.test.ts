import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/003_notification_production_completion.sql", "utf8");

describe("Notification production completion migration", () => {
  it("defines state-tracking for catch-up scheduling", () => {
    expect(migration).toContain("create table if not exists public.notification_milestone_states (");
    expect(migration).toContain("state text not null check (state in ('satisfied', 'event_created'))");
    expect(migration).toContain("primary key (circuit_id, expiry_version, milestone_key)");
    expect(migration).toContain("notification_events(");
    expect(migration).toContain("is_catch_up boolean not null default false");
    expect(migration).toContain("catch_up_milestone_keys text[] not null default '{}'::text[]");
    expect(migration).toMatch(/alter table public\.notification_events\s+add column if not exists is_catch_up boolean not null default false;/);
  });

  it("adds deterministic due-event generation with version-scoped state", () => {
    expect(migration).toContain("create or replace function public.ensure_due_notification_events(");
    expect(migration).toContain("p_circuit_id uuid,\n  p_expiry_version integer,");
    expect(migration).toContain("p_milestones jsonb");
    expect(migration).toContain("perform 1 from public.circuits where id = p_circuit_id for update;");
    expect(migration).toContain("select exists(\n    select 1 from public.notification_milestone_states\n    where circuit_id = p_circuit_id and expiry_version = p_expiry_version\n  ) into v_has_states;");
    expect(migration).toContain("order by (item ->> 'dueDate')::date, item ->> 'key'");
    expect(migration).toContain("v_event_ids uuid[] := '{}'::uuid[];");
    expect(migration).toContain("return v_event_ids;");
  });

  it("adds atomic delivery claim RPC for queued and retry work", () => {
    expect(migration).toContain("create or replace function public.claim_notification_deliveries(p_limit integer default 100)");
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("set status = 'sending'");
    expect(migration).toContain("attempts = coalesce(d.attempts, 0) + 1,");
    expect(migration).toContain("status in ('queued', 'retry_scheduled')");
    expect(migration).toContain("and (\n        d.status = 'queued'\n        or d.next_attempt_at is null\n        or d.next_attempt_at <= timezone('utc', now())\n      )");
    expect(migration).toContain("returning\n      d.id,");
    expect(migration).toContain("grant execute on function public.claim_notification_deliveries(integer) to service_role;");
  });
});
