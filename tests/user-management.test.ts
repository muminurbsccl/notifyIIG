import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiProfile: vi.fn(),
  createServiceSupabaseClient: vi.fn(),
  writeAudit: vi.fn(),
  authAdmin: {
    createUser: vi.fn(),
    inviteUserByEmail: vi.fn(),
    updateUserById: vi.fn(),
    deleteUser: vi.fn(),
    listUsers: vi.fn(),
  },
  profiles: [] as Record<string, unknown>[],
}));

class MockAuthError extends Error {
  status = 403 as const;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  requireApiProfile: mocks.requireApiProfile,
  APP_ROLES: ["admin", "provider_manager", "operations_editor", "auditor", "viewer"],
  AuthError: MockAuthError,
}));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabaseClient: mocks.createServiceSupabaseClient,
}));

const { GET, POST } = await import("@/app/api/users/route");
const { PATCH, DELETE } = await import("@/app/api/users/[id]/route");

function responseChain(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.update = () => chain;
  chain.delete = () => chain;
  chain.single = () => chain;
  chain.maybeSingle = () => {
    chain.then = (resolve: (value: unknown) => void) => resolve({ data: Array.isArray(data) ? data[0] ?? null : data, error });
    return chain;
  };
  chain.then = (resolve: (value: unknown) => void) => resolve({ data, error });
  return chain;
}

function request(body: unknown, method = "POST") {
  return new Request("http://localhost/api/users", {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profiles = [{ id: "user-1", email: "admin@example.com", role: "admin", active: true }];
  mocks.requireApiProfile.mockResolvedValue({ user: { id: "actor-1" }, profile: { role: "admin" } });
  mocks.authAdmin.createUser.mockResolvedValue({ data: { user: { id: "user-2", email: "new@example.com" } }, error: null });
  mocks.authAdmin.inviteUserByEmail.mockResolvedValue({ data: { user: { id: "user-2", email: "new@example.com" } }, error: null });
  mocks.authAdmin.updateUserById.mockResolvedValue({ data: { user: { id: "user-2" } }, error: null });
  mocks.authAdmin.deleteUser.mockResolvedValue({ error: null });
  mocks.authAdmin.listUsers.mockResolvedValue({ data: { users: [] }, error: null });
  mocks.createServiceSupabaseClient.mockReturnValue({
    auth: { admin: mocks.authAdmin },
    from: () => responseChain(mocks.profiles),
  });
});

describe("admin user management", () => {
  it("rejects non-admin access", async () => {
    mocks.requireApiProfile.mockRejectedValue(new Error("forbidden"));
    const response = await GET(new Request("http://localhost/api/users"));
    expect(response.status).toBe(500);
  });

  it("creates an invited user without returning password data", async () => {
    const response = await POST(request({ email: "new@example.com", fullName: "New User", role: "viewer", active: true }));
    expect(response.status).toBe(201);
    expect(mocks.authAdmin.inviteUserByEmail).toHaveBeenCalledWith("new@example.com", { data: { full_name: "New User" } });
    expect(JSON.stringify(await response.json())).not.toContain("password");
  });

  it("rejects deactivating the last active administrator", async () => {
    const response = await PATCH(
      request({ active: false }, "PATCH"),
      { params: Promise.resolve({ id: "user-1" }) },
    );
    expect(response.status).toBe(422);
    expect(mocks.authAdmin.updateUserById).not.toHaveBeenCalled();
  });

  it("does not allow deleting the current administrator", async () => {
    const response = await DELETE(new Request("http://localhost/api/users/user-1"), {
      params: Promise.resolve({ id: "actor-1" }),
    });
    expect(response.status).toBe(422);
    expect(mocks.authAdmin.deleteUser).not.toHaveBeenCalled();
  });
});
