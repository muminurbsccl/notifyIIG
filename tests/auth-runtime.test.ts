import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/config", () => ({
  getPublicConfig: () => ({
    configured: true,
    supabaseUrl: "https://supabase.example.test",
    supabaseAnonKey: "anon-key",
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
  })),
}));

import { requireApiProfile } from "@/lib/auth";

describe("API authentication error mapping", () => {
  beforeEach(() => mocks.getUser.mockReset());

  it("maps a normal missing session to 401", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { name: "AuthSessionMissingError", status: 400 },
    });

    await expect(requireApiProfile()).rejects.toMatchObject({ status: 401 });
  });

  it("maps an auth provider outage to 503", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { name: "AuthApiError", status: 429 },
    });

    await expect(requireApiProfile()).rejects.toMatchObject({ status: 503 });
  });
});
