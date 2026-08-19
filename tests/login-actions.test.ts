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
  rpc: vi.fn(),
  createClient: vi.fn(),
  getServerConfig: vi.fn(() => ({
    appBaseUrl: "https://notifyiig.vercel.app",
    supabaseUrl: "https://xyz.supabase.co",
    serviceRoleKey: "svc-key" as string | null,
  })),
}));

const authClient = {
  auth: {
    signInWithOtp: mocks.signInWithOtp,
    signInWithPassword: mocks.signInWithPassword,
    signOut: mocks.signOut,
  },
};

const serviceClient = {
  rpc: mocks.rpc,
};

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/server-config", () => ({ getServerConfig: mocks.getServerConfig }));
vi.mock("@/lib/supabase/server", () => ({
  createWritableServerSupabaseClient: mocks.createWritableClient,
}));
vi.mock("@/lib/auth", () => ({ getAuthContext: mocks.getAuthContext }));

const { beginSignIn, requestMagicLink, signInWithPassword } = await import("@/app/login/actions");

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
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.createClient.mockReturnValue(serviceClient);
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

  it("maps a magic-link email rate limit to a dedicated state", async () => {
    mocks.signInWithOtp.mockResolvedValue({
      data: {},
      error: { code: "over_email_send_rate_limit", status: 429, message: "email rate limit exceeded" },
    });

    await expectRedirect(
      requestMagicLink(formData({ email: "person@example.com" })),
      "/login?error=rate-limited",
    );
  });

  it("maps a password rate limit to a dedicated state", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "over_request_rate_limit", status: 429, message: "too many requests" },
    });

    await expectRedirect(
      signInWithPassword(formData({ email: "person@example.com", password: "bad" })),
      "/login?error=rate-limited&method=password",
    );
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

  describe("beginSignIn (email-first)", () => {
    it("routes an account with a password to the password step", async () => {
      mocks.rpc.mockResolvedValue({ data: true, error: null });

      await expectRedirect(
        beginSignIn(formData({ email: " Person@Example.COM " })),
        "/login?step=password&email=person%40example.com",
      );

      expect(mocks.createClient).toHaveBeenCalledWith(
        "https://xyz.supabase.co",
        "svc-key",
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      expect(mocks.rpc).toHaveBeenCalledWith("auth_user_has_password", {
        email: "person@example.com",
      });
      expect(mocks.signInWithOtp).not.toHaveBeenCalled();
    });

    it("sends a magic link for any account without a password (anti-enumeration)", async () => {
      mocks.rpc.mockResolvedValue({ data: false, error: null });
      mocks.signInWithOtp.mockResolvedValue({ error: null });

      await expectRedirect(
        beginSignIn(formData({ email: "person@example.com" })),
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

    it("does not reveal whether an unknown email exists", async () => {
      mocks.rpc.mockResolvedValue({ data: false, error: null });
      mocks.signInWithOtp.mockResolvedValue({ error: null });

      await expectRedirect(
        beginSignIn(formData({ email: "unknown@example.com" })),
        "/login?notice=link-sent",
      );
    });

    it("maps invalid email input to a fixed public state", async () => {
      await expectRedirect(
        beginSignIn(formData({ email: "not-an-email" })),
        "/login?error=invalid-input",
      );
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.signInWithOtp).not.toHaveBeenCalled();
    });

    it("maps a magic-link email rate limit to a dedicated state", async () => {
      mocks.rpc.mockResolvedValue({ data: false, error: null });
      mocks.signInWithOtp.mockResolvedValue({
        data: {},
        error: { code: "over_email_send_rate_limit", status: 429, message: "email rate limit exceeded" },
      });

      await expectRedirect(
        beginSignIn(formData({ email: "person@example.com" })),
        "/login?error=rate-limited",
      );
    });

    it("does not reflect an RPC failure and never sends a link", async () => {
      mocks.rpc.mockResolvedValue({ data: null, error: new Error("database connection detail") });

      await expectRedirect(
        beginSignIn(formData({ email: "person@example.com" })),
        "/login?error=service-unavailable",
      );
      expect(mocks.signInWithOtp).not.toHaveBeenCalled();
    });

    it("maps a missing service-role key to service unavailable", async () => {
      mocks.getServerConfig.mockReturnValueOnce({
        appBaseUrl: "https://notifyiig.vercel.app",
        supabaseUrl: "https://xyz.supabase.co",
        serviceRoleKey: null,
      });

      await expectRedirect(
        beginSignIn(formData({ email: "person@example.com" })),
        "/login?error=service-unavailable",
      );
      expect(mocks.createClient).not.toHaveBeenCalled();
    });

    it("maps GoTrue otp_disabled to the same link-sent state as a passwordless account", async () => {
      mocks.rpc.mockResolvedValue({ data: false, error: null });
      mocks.signInWithOtp.mockResolvedValue({
        data: {},
        error: { code: "otp_disabled", status: 422, message: "Signups not allowed for otp" },
      });

      await expectRedirect(
        beginSignIn(formData({ email: "unknown@example.com" })),
        "/login?notice=link-sent",
      );
    });

    it("maps a non-otp_disabled magic-link provider error to service unavailable", async () => {
      mocks.rpc.mockResolvedValue({ data: false, error: null });
      mocks.signInWithOtp.mockResolvedValue({
        data: {},
        error: { code: "email_provider_disabled", status: 400, message: "provider secret detail" },
      });

      await expectRedirect(
        beginSignIn(formData({ email: "person@example.com" })),
        "/login?error=service-unavailable",
      );
    });
  });

  describe("signInWithPassword (password step)", () => {
    it("preserves the step and email on invalid credentials", async () => {
      mocks.signInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: { code: "invalid_credentials", status: 400, message: "provider secret detail" },
      });

      const data = formData({ email: "person@example.com", password: "bad" });
      data.set("step", "password");

      await expectRedirect(
        signInWithPassword(data),
        "/login?error=invalid-credentials&step=password&email=person%40example.com",
      );
    });

    it("preserves the step and email on a rate limit", async () => {
      mocks.signInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: { code: "over_request_rate_limit", status: 429, message: "too many requests" },
      });

      const data = formData({ email: "person@example.com", password: "bad" });
      data.set("step", "password");

      await expectRedirect(
        signInWithPassword(data),
        "/login?error=rate-limited&step=password&email=person%40example.com",
      );
    });

    it("redirects to the dashboard on success from the step form", async () => {
      mocks.signInWithPassword.mockResolvedValue({
        data: { user: { id: "user-1" }, session: { access_token: "hidden" } },
        error: null,
      });
      mocks.getAuthContext.mockResolvedValue({
        user: { id: "user-1" },
        profile: { id: "user-1", active: true, role: "admin" },
        supabase: authClient,
      });

      const data = passwordFormData("correct");
      data.set("step", "password");

      await expectRedirect(signInWithPassword(data), "/dashboard");
    });

    it("clears a step-form session that has no authorized profile", async () => {
      mocks.signInWithPassword.mockResolvedValue({
        data: { user: { id: "user-1" }, session: { access_token: "hidden" } },
        error: null,
      });
      mocks.getAuthContext.mockResolvedValue(null);

      const data = passwordFormData("correct");
      data.set("step", "password");

      await expectRedirect(
        signInWithPassword(data),
        "/login?error=not-authorized&step=password&email=person%40example.com",
      );
    });
  });
});
