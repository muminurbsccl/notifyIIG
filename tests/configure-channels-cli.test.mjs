import { describe, expect, it } from "vitest";
import { runCli } from "../scripts/configure-channels.mjs";

function harness(overrides = {}) {
  const output = [];
  const calls = { dry: 0, apply: 0, ended: 0 };
  return {
    output, calls,
    options: {
      argv: ["config.json"], env: {}, stdin: { isTTY: true },
      stdout: { write: (value) => output.push(String(value)) }, stderr: { write: (value) => output.push(String(value)) },
      dependencies: {
        readFile: async () => JSON.stringify({ projectRef: "project123", actorEmail: "admin@example.com" }),
        parseChannelConfig: (raw) => raw,
        validateEnvironment: () => ({}),
        createClient: () => ({ connect: async () => {}, end: async () => { calls.ended += 1; } }),
        runDryRun: async () => { calls.dry += 1; return { projectRef: "project123", providers: [] }; },
        applyChangePlan: async () => { calls.apply += 1; return { projectRef: "project123", providers: [] }; },
        formatRedactedPreview: () => "redacted preview",
        prompt: async () => "project123",
      }, ...overrides,
    },
  };
}

describe("configure channels CLI", () => {
  it("defaults to dry run", async () => {
    const h = harness();
    expect(await runCli(h.options)).toBe(0);
    expect(h.calls).toMatchObject({ dry: 1, apply: 0, ended: 1 });
    expect(h.output.join("")).toContain("redacted preview");
  });

  it("rejects usage errors before connecting", async () => {
    const h = harness({ argv: [] });
    expect(await runCli(h.options)).toBe(2);
    expect(h.calls.ended).toBe(0);
  });

  it("requires a TTY and exact project confirmation for apply", async () => {
    const nonTty = harness({ argv: ["config.json", "--apply"], stdin: { isTTY: false } });
    expect(await runCli(nonTty.options)).toBe(2);
    expect(nonTty.calls.apply).toBe(0);
    const rejected = harness({ argv: ["config.json", "--apply"], dependencies: { ...harness().options.dependencies, prompt: async () => "wrong" } });
    expect(await runCli(rejected.options)).toBe(3);
    expect(rejected.calls.apply).toBe(0);
  });

  it("applies after exact confirmation", async () => {
    const h = harness({ argv: ["config.json", "--apply"] });
    expect(await runCli(h.options)).toBe(0);
    expect(h.calls.apply).toBe(1);
    expect(h.calls.ended).toBe(1);
  });
});
