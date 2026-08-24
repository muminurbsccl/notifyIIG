import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/009_expiry_day_milestone.sql", "utf8");

describe("Expiry-day milestone migration", () => {
  it("registers an enabled T-0 milestone on the default rule", () => {
    expect(migration).toContain("'T-0'");
    expect(migration).toContain("'Expiry-day notification'");
    expect(migration).toMatch(/days_before,\s*enabled/);
    expect(migration).toMatch(/select id,\s*'T-0',\s*'Expiry-day notification',\s*0,\s*true/);
    expect(migration).toContain("where code = 'global-default'");
  });

  it("is idempotent and re-enables on conflict", () => {
    expect(migration).toContain("on conflict (rule_id, milestone_key) do update set enabled = true, label = excluded.label");
  });
});
