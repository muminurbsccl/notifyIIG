import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isExpectedUnauthenticatedError } from "@/lib/domain/auth-errors";

const middleware = readFileSync("middleware.ts", "utf8");
const auth = readFileSync("lib/auth.ts", "utf8");
const migration = readFileSync("supabase/migrations/001_initial.sql", "utf8");

describe("authentication boundary artifacts", () => {
  it("keeps middleware profile-blind with page-layer enforcement and a loop-safe login escape", () => {
    // Middleware must not query profiles on the hot path; active/role checks
    // live in requireProfile/requireApiProfile instead.
    expect(middleware).not.toContain('.from("profiles")');
    // Authenticated users bounce off public pages unless /login carries an
    // error param, which prevents redirect loops for inactive accounts.
    expect(middleware).toContain('!(pathname === "/login" && request.nextUrl.searchParams.has("error"))');
    expect(middleware).toContain('return redirectWithSession("/dashboard")');
    // Page layer remains the authorization boundary for inactive accounts.
    expect(auth).toContain('redirect("/login?error=not-authorized")');
  });

  it("preserves refreshed cookies when middleware redirects", () => {
    expect(middleware).toContain("response.cookies.getAll().forEach");
    expect(middleware).toContain("redirectResponse.cookies.set(cookie)");
    expect(middleware).toContain("AUTH_SERVICE_UNAVAILABLE");
  });

  it("lets the callback and public metadata routes reach their handlers", () => {
    expect(middleware).toContain('"/auth/callback"');
    expect(middleware).toContain('"/robots.txt"');
    expect(middleware).toContain('"/icon.png"');
    expect(middleware).toContain('"/apple-icon.png"');
    expect(middleware).toContain('"/brand"');
    expect(middleware).toContain("middlewareBypassPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))");
  });

  it("distinguishes auth service errors from invalid sessions", () => {
    expect(isExpectedUnauthenticatedError({ name: "AuthSessionMissingError", status: 400 })).toBe(true);
    expect(isExpectedUnauthenticatedError({ status: 401 })).toBe(true);
    expect(isExpectedUnauthenticatedError({ status: 403 })).toBe(true);
    expect(isExpectedUnauthenticatedError({ name: "AuthSessionMissingError", status: 429 })).toBe(false);
    expect(isExpectedUnauthenticatedError({ status: 429 })).toBe(false);
    expect(auth).toContain("isExpectedUnauthenticatedError");
    expect(auth).toContain("Authentication service is unavailable");
    expect(migration).toContain("public.is_active_user() and exists");
  });

  it("cleans policies by app-owned table scope and declares current policies", () => {
    expect(migration).toContain("select policyname, tablename");
    expect(migration).toContain("tablename = any (array[");
    expect(migration).toContain("execute format('drop policy if exists %I on public.%I'");
    expect(migration).not.toContain("policyname = any (array[");
    expect(migration).toContain("revoke all on table public.audit_logs from authenticated");
    expect(migration).not.toContain("create policy audit_insert_active_actor");

    for (const policyName of [
      "profiles_select_self_or_admin",
      "rules_select_active_scope",
      "milestones_select_scope",
      "circuits_update_admin_editor",
      "deliveries_select_scope",
    ]) {
      expect(migration).toContain(`create policy ${policyName}`);
    }
  });
});
