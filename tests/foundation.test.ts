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
});
