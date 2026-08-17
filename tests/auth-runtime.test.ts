import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createServerClient: vi.fn(),
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
  createServerSupabaseClient: mocks.createServerClient,
}));

import { getAuthContext, requireApiProfile } from "@/lib/auth";

describe("API authentication error mapping", () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
    mocks.createServerClient.mockReset();
    mocks.createServerClient.mockResolvedValue({ auth: { getUser: mocks.getUser } });
  });

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

  it("uses an injected session client instead of creating another client", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "user-1",
        email: "person@example.com",
        full_name: "Example Person",
        role: "admin",
        active: true,
        allowed_provider_ids: [],
      },
      error: null,
    });
    const injected = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "person@example.com" } },
          error: null,
        }),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
      })),
    };

    const context = await getAuthContext(injected as never);

    expect(context?.profile.role).toBe("admin");
    expect(context?.supabase).toBe(injected);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });
});
