import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("public login rendering contract", () => {
  it("renders authentication forms without a browser Supabase client", () => {
    const form = readFileSync("components/login-form.tsx", "utf8");
    expect(form).not.toContain('"use client"');
    expect(form).not.toContain("createBrowserSupabaseClient");
    expect(form).toContain("requestMagicLink");
    expect(form).toContain("signInWithPassword");
    expect(form).toContain('autoComplete="email"');
    expect(form).toContain('autoComplete="current-password"');
  });

  it("awaits Next 15 search parameters and exposes only fixed public states", () => {
    const page = readFileSync("app/login/page.tsx", "utf8");
    expect(page).toContain("searchParams: Promise<");
    expect(page).toContain("await searchParams");
    expect(page).not.toContain("force-dynamic");
  });
});
