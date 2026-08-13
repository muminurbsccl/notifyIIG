import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import vercelConfig from "../vercel.json";

describe("deployment foundation", () => {
  it("declares one daily expiry-notification cron", () => {
    expect(vercelConfig.crons).toEqual([
      {
        path: "/api/cron/expiry-notifications",
        schedule: "0 3 * * *",
      },
    ]);
  });

  it("ships a tracked environment variable template for deployments", async () => {
    const template = await readFile(new URL("../env.example", import.meta.url), "utf8");
    expect(template).toContain("NEXT_PUBLIC_SUPABASE_URL=");
    expect(template).toContain("SUPABASE_SERVICE_ROLE_KEY=");
    expect(template).toContain("CRON_SECRET=");
  });

  it("bundles and renders the official BSCPLC logo locally", async () => {
    const logo = await readFile(new URL("../public/brand/bscplc-logo.webp", import.meta.url));
    const component = await readFile(new URL("../components/brand-logo.tsx", import.meta.url), "utf8");
    expect(logo.byteLength).toBeGreaterThan(1_000);
    expect(component).toContain('/brand/bscplc-logo.webp');
    expect(component).toContain('alt="BSCPLC logo"');
  });
});
