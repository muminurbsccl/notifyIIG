import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn() }));

vi.mock("@/lib/config", () => ({
  getPublicConfig: () => ({
    configured: true,
    supabaseUrl: "https://supabase.example.test",
    supabaseAnonKey: "anon-key",
  }),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));

const { middleware } = await import("@/middleware");

describe("middleware metadata route bypass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServerClient.mockReturnValue({
      auth: {
        getUser: async () => ({
          data: { user: null },
          error: { name: "AuthSessionMissingError", status: 400 },
        }),
      },
    });
  });

  it.each([
    "/auth/callback",
    "/robots.txt",
    "/favicon.ico",
    "/icon",
    "/icon.png",
    "/apple-icon",
    "/apple-icon.png",
  ])("lets %s reach its route handler without session middleware", async (pathname) => {
    const response = await middleware(
      new NextRequest(`https://notifyiig.vercel.app${pathname}`),
    );
    expect(response.headers.get("location")).toBeNull();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("does not expose a nearby protected path", async () => {
    const response = await middleware(
      new NextRequest("https://notifyiig.vercel.app/icon-admin"),
    );
    expect(response.headers.get("location")).toBe("https://notifyiig.vercel.app/login");
    expect(mocks.createServerClient).toHaveBeenCalledOnce();
  });
});
