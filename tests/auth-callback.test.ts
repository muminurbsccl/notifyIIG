import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  signOut: vi.fn(),
  getAuthContext: vi.fn(),
  cookieAdapter: null as null | { setAll(values: unknown[]): void },
}));

const authClient = {
  auth: {
    exchangeCodeForSession: mocks.exchangeCodeForSession,
    signOut: mocks.signOut,
  },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config", () => ({
  getPublicConfig: () => ({
    configured: true,
    supabaseUrl: "https://supabase.example.test",
    supabaseAnonKey: "anon-key",
  }),
}));
vi.mock("@/lib/auth", () => ({ getAuthContext: mocks.getAuthContext }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));

const { GET } = await import("@/app/auth/callback/route");

function request(query = "?code=callback-code&next=/dashboard"): NextRequest {
  return new NextRequest(`https://notifyiig.vercel.app/auth/callback${query}`);
}

describe("PKCE authentication callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookieAdapter = null;
    mocks.createServerClient.mockImplementation((_url, _key, options) => {
      mocks.cookieAdapter = options.cookies;
      return authClient;
    });
    mocks.exchangeCodeForSession.mockImplementation(async () => {
      mocks.cookieAdapter?.setAll([
        { name: "sb-session", value: "opaque-session", options: { httpOnly: true } },
      ]);
      return { data: { session: { access_token: "hidden" } }, error: null };
    });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.getAuthContext.mockResolvedValue({
      user: { id: "user-1" },
      profile: { id: "user-1", active: true, role: "admin" },
      supabase: authClient,
    });
  });

  it("exchanges the code and copies session cookies to the dashboard redirect", async () => {
    const response = await GET(request());

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("callback-code");
    expect(response.headers.get("location")).toBe("https://notifyiig.vercel.app/dashboard");
    expect(response.cookies.get("sb-session")?.value).toBe("opaque-session");
  });

  it("falls back to dashboard for an external next destination", async () => {
    const response = await GET(request("?code=callback-code&next=//evil.example"));
    expect(response.headers.get("location")).toBe("https://notifyiig.vercel.app/dashboard");
  });

  it("rejects a callback without a code", async () => {
    const response = await GET(request("?next=/dashboard"));
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://notifyiig.vercel.app/login?error=invalid-link",
    );
  });

  it("maps an expired code to a fixed invalid-link state", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: { code: "otp_expired", message: "provider detail callback-code" },
    });
    const response = await GET(request());
    expect(response.headers.get("location")).toBe(
      "https://notifyiig.vercel.app/login?error=invalid-link",
    );
    expect(response.headers.get("location")).not.toContain("callback-code");
  });

  it("clears an unauthorized session and returns a fixed state", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    const response = await GET(request());
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(response.headers.get("location")).toBe(
      "https://notifyiig.vercel.app/login?error=not-authorized",
    );
  });

  it("maps failed unauthorized cleanup to service unavailable", async () => {
    mocks.getAuthContext.mockResolvedValue(null);
    mocks.signOut.mockResolvedValue({ error: new Error("provider cleanup detail") });
    const response = await GET(request());
    expect(response.headers.get("location")).toBe(
      "https://notifyiig.vercel.app/login?error=service-unavailable",
    );
  });

  it("maps profile service failures without reflecting details", async () => {
    mocks.getAuthContext.mockRejectedValue(new Error("database provider detail callback-code"));
    const response = await GET(request());
    expect(response.headers.get("location")).toBe(
      "https://notifyiig.vercel.app/login?error=service-unavailable",
    );
  });
});
