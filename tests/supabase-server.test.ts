import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  createServerClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: mocks.cookieSet,
  }),
}));
vi.mock("@/lib/config", () => ({
  getPublicConfig: () => ({
    configured: true,
    supabaseUrl: "https://supabase.example.test",
    supabaseAnonKey: "anon-key",
  }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

const { createServerSupabaseClient, createWritableServerSupabaseClient } = await import(
  "@/lib/supabase/server"
);

function configuredCookieAdapter(): {
  cookies: { setAll(values: { name: string; value: string; options: object }[]): void };
} {
  return mocks.createServerClient.mock.results.at(-1)?.value.options;
}

describe("server Supabase cookie boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServerClient.mockImplementation((_url, _key, options) => ({ options }));
    mocks.cookieSet.mockImplementation(() => {
      throw new Error("cookies are read-only");
    });
  });

  it("allows a read-only Server Component client to ignore forbidden cookie writes", async () => {
    await createServerSupabaseClient();
    const adapter = configuredCookieAdapter();

    expect(() =>
      adapter.cookies.setAll([{ name: "session", value: "value", options: {} }]),
    ).not.toThrow();
  });

  it("propagates forbidden cookie writes from a writable action client", async () => {
    await createWritableServerSupabaseClient();
    const adapter = configuredCookieAdapter();

    expect(() =>
      adapter.cookies.setAll([{ name: "session", value: "value", options: {} }]),
    ).toThrow("cookies are read-only");
  });
});
