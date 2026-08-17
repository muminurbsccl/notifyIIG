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

  it("declares production canonical and social metadata", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    const page = readFileSync("app/login/page.tsx", "utf8");
    expect(layout).toContain('metadataBase: new URL("https://notifyiig.vercel.app")');
    expect(layout).toContain("openGraph:");
    expect(layout).toContain("twitter:");
    expect(layout).toContain("icons:");
    expect(page).toContain('canonical: "/login"');
    expect(page).toContain("...PUBLIC_OPEN_GRAPH");
  });

  it("ships a valid public robots policy and PNG icon", () => {
    const robots = readFileSync("app/robots.ts", "utf8");
    const icon = readFileSync("app/icon.png");
    expect(robots).toContain('allow: "/login"');
    expect(robots).toContain('"/dashboard"');
    expect(robots).toContain('"/circuits"');
    expect(icon.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });
});
