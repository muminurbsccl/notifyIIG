import { describe, expect, it } from "vitest";
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
});
