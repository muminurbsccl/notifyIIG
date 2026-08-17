import { beforeEach, describe, expect, it, vi } from "vitest";

class RedirectSignal extends Error {
  constructor(readonly location: string) {
    super(`NEXT_REDIRECT:${location}`);
  }
}

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((location: string) => {
    throw new RedirectSignal(location);
  }),
  signInWithOtp: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  createWritableClient: vi.fn(),
  getAuthContext: vi.fn(),
}));

const authClient = {
  auth: {
    signInWithOtp: mocks.signInWithOtp,
    signInWithPassword: mocks.signInWithPassword,
    signOut: mocks.signOut,
  },
};

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/server-config", () => ({
  getServerConfig: () => ({ appBaseUrl: "https://notifyiig.vercel.app" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createWritableServerSupabaseClient: mocks.createWritableClient,
}));
vi.mock("@/lib/auth", () => ({ getAuthContext: mocks.getAuthContext }));

const { requestMagicLink, signInWithPassword } = await import("@/app/login/actions");

function formData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function passwordFormData(password: string): FormData {
  const data = formData({ email: "person@example.com" });
  data.set("password", password);
  return data;
}

async function expectRedirect(promise: Promise<void>, location: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ location });
}

describe("server login actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createWritableClient.mockResolvedValue(authClient);
    mocks.signOut.mockResolvedValue({ error: null });
  });

  it("requests an invitation-only magic link for the production PKCE callback", async () => {
    mocks.signInWithOtp.mockResolvedValue({ error: null });

    await expectRedirect(
      requestMagicLink(formData({ email: " Person@Example.COM " })),
      "/login?notice=link-sent",
    );

    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: "person@example.com",
      options: {
        emailRedirectTo: "https://notifyiig.vercel.app/auth/callback",
        shouldCreateUser: false,
      },
    });
  });

  it("maps invalid magic-link input to a fixed public state", async () => {
    await expectRedirect(
      requestMagicLink(formData({ email: "not-an-email" })),
      "/login?error=invalid-input",
    );
    expect(mocks.signInWithOtp).not.toHaveBeenCalled();
  });

  it("does not reflect a magic-link provider error", async () => {
    mocks.signInWithOtp.mockResolvedValue({ error: new Error("provider secret detail") });

    await expectRedirect(
      requestMagicLink(formData({ email: "person@example.com" })),
      "/login?error=service-unavailable",
    );
    expect(mocks.redirect).not.toHaveBeenCalledWith(expect.stringContaining("provider"));
  });

  it("maps invalid password credentials without reflecting provider details", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "invalid_credentials", status: 400, message: "provider secret detail" },
    });

    await expectRedirect(
      signInWithPassword(formData({ email: "person@example.com", password: "bad" })),
      "/login?error=invalid-credentials&method=password",
    );
  });

  it("maps a non-credential provider HTTP 400 to service unavailable", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: {
        code: "unexpected_failure",
        status: 400,
        message: "token=provider-secret-detail",
      },
    });

    await expectRedirect(
      signInWithPassword(formData({ email: "person@example.com", password: "bad" })),
      "/login?error=service-unavailable&method=password",
    );
  });

  it("authorizes the newly established session with the same client", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: "user-1" }, session: { access_token: "hidden" } },
      error: null,
    });
    mocks.getAuthContext.mockResolvedValue({
      user: { id: "user-1" },
      profile: { id: "user-1", active: true, role: "admin" },
      supabase: authClient,
    });

    await expectRedirect(
      signInWithPassword(passwordFormData("correct")),
      "/dashboard",
    );

    expect(mocks.getAuthContext).toHaveBeenCalledWith(authClient);
  });

  it("clears a session that has no authorized profile", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: "user-1" }, session: { access_token: "hidden" } },
      error: null,
    });
    mocks.getAuthContext.mockResolvedValue(null);

    await expectRedirect(
      signInWithPassword(passwordFormData("correct")),
      "/login?error=not-authorized",
    );

    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it("does not report unauthorized cleanup when sign-out returns an error", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: "user-1" }, session: { access_token: "hidden" } },
      error: null,
    });
    mocks.getAuthContext.mockResolvedValue(null);
    mocks.signOut.mockResolvedValue({
      error: { code: "cleanup_failed", message: "token=provider-secret-detail" },
    });

    await expectRedirect(
      signInWithPassword(passwordFormData("correct")),
      "/login?error=service-unavailable&method=password",
    );
  });

  it("maps an authorization provider outage to a generic state", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: "user-1" }, session: { access_token: "hidden" } },
      error: null,
    });
    mocks.getAuthContext.mockRejectedValue(new Error("database connection detail"));

    await expectRedirect(
      signInWithPassword(passwordFormData("correct")),
      "/login?error=service-unavailable&method=password",
    );
  });

  it("maps invalid password form input without calling Supabase", async () => {
    await expectRedirect(
      signInWithPassword(formData({ email: "person@example.com", password: "" })),
      "/login?error=invalid-input&method=password",
    );
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });
});
