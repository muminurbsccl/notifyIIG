import { NextResponse } from "next/server";
import { APP_ROLES } from "@/lib/auth";
import { requireApiProfile } from "@/lib/auth";
import { jsonError, InputError } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

function input(body: Record<string, unknown>) {
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const role = typeof body.role === "string" ? body.role : "viewer";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new InputError("INVALID_EMAIL", "A valid email is required");
  if (!APP_ROLES.includes(role as (typeof APP_ROLES)[number])) throw new InputError("INVALID_ROLE", "Invalid user role");
  if (password && password.length < 8) throw new InputError("INVALID_PASSWORD", "Password must be at least 8 characters");
  return {
    email,
    fullName,
    role,
    active: body.active !== false,
    password: password || null,
    allowedProviderIds: Array.isArray(body.allowedProviderIds)
      ? body.allowedProviderIds.filter((value): value is string => typeof value === "string")
      : [],
  };
}

function safeProfile(profile: Record<string, unknown>) {
  return {
    id: profile.id,
    email: profile.email ?? null,
    full_name: profile.full_name ?? "",
    role: profile.role,
    active: profile.active === true,
    allowed_provider_ids: Array.isArray(profile.allowed_provider_ids) ? profile.allowed_provider_ids : [],
    created_at: profile.created_at ?? null,
    last_login_at: profile.last_login_at ?? null,
  };
}

export async function GET(_request: Request) {
  try {
    await requireApiProfile(["admin"]);
    const service = createServiceSupabaseClient();
    const [{ data: profiles, error: profileError }, { data: authUsers, error: authError }, { data: providers, error: providerError }] = await Promise.all([
      service.from("profiles").select("id,email,full_name,role,active,allowed_provider_ids,created_at,last_login_at"),
      service.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      service.from("providers").select("id,name,code").eq("active", true).order("name"),
    ]);
    if (profileError) throw profileError;
    if (authError) throw authError;
    if (providerError) throw providerError;
    const lastSignIn = new Map((authUsers.users ?? []).map((user) => [user.id, user.last_sign_in_at ?? null]));
    return NextResponse.json({ users: (profiles ?? []).map((profile) => ({ ...safeProfile(profile), last_login_at: lastSignIn.get(String(profile.id)) ?? profile.last_login_at ?? null })), providers: providers ?? [] });
  } catch (cause) {
    return jsonError(cause);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireApiProfile(["admin"]);
    const values = input((await request.json()) as Record<string, unknown>);
    const service = createServiceSupabaseClient();
    const result = values.password
      ? await service.auth.admin.createUser({ email: values.email, password: values.password, email_confirm: true, user_metadata: { full_name: values.fullName } })
      : await service.auth.admin.inviteUserByEmail(values.email, { data: { full_name: values.fullName } });
    if (result.error || !result.data.user) throw result.error ?? new Error("User creation failed");
    const { data: profile, error: profileError } = await service
      .from("profiles")
      .update({ email: values.email, full_name: values.fullName, role: values.role, active: values.active, allowed_provider_ids: values.allowedProviderIds })
      .eq("id", result.data.user.id)
      .select()
      .single();
    if (profileError) {
      await service.auth.admin.deleteUser(result.data.user.id);
      throw profileError;
    }
    await writeAudit({ actorUserId: actor.user.id, action: "user.create", entityType: "profile", entityId: result.data.user.id, after: { email: values.email, fullName: values.fullName, role: values.role, active: values.active }, requestId: request.headers.get("x-request-id") });
    return NextResponse.json({ user: safeProfile(profile) }, { status: 201 });
  } catch (cause) {
    return jsonError(cause);
  }
}
