import { NextResponse } from "next/server";
import { APP_ROLES } from "@/lib/auth";
import { requireApiProfile } from "@/lib/auth";
import { jsonError, jsonNotFound, InputError } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

type Context = { params: Promise<{ id: string }> };

function roleOf(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !APP_ROLES.includes(value as (typeof APP_ROLES)[number])) throw new InputError("INVALID_ROLE", "Invalid user role");
  return value;
}

async function activeAdminCount(service: ReturnType<typeof createServiceSupabaseClient>) {
  const { data, error } = await service.from("profiles").select("id,role,active");
  if (error) throw error;
  return (data ?? []).filter((profile) => profile.active === true && profile.role === "admin").length;
}

export async function PATCH(request: Request, context: Context) {
  try {
    const actor = await requireApiProfile(["admin"]);
    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const service = createServiceSupabaseClient();
    const { data: existing, error: existingError } = await service.from("profiles").select("*").eq("id", id).maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return jsonNotFound("User not found");
    const nextRole = roleOf(body.role) ?? existing.role;
    const nextActive = typeof body.active === "boolean" ? body.active : existing.active === true;
    const selfChange = id === actor.user.id;
    if (selfChange && (nextRole !== "admin" || !nextActive)) throw new InputError("SELF_PROTECTION", "You cannot deactivate or demote your own admin account", 422);
    if (existing.role === "admin" && existing.active === true && (nextRole !== "admin" || !nextActive) && (await activeAdminCount(service)) <= 1) {
      throw new InputError("LAST_ADMIN", "The last active administrator cannot be deactivated or demoted", 422);
    }
    const password = typeof body.password === "string" && body.password ? body.password : null;
    if (password && password.length < 8) throw new InputError("INVALID_PASSWORD", "Password must be at least 8 characters");
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
    const fullName = typeof body.fullName === "string" ? body.fullName.trim() : String(existing.full_name ?? "");
    const authUpdate: Record<string, unknown> = { user_metadata: { full_name: fullName } };
    if (email) authUpdate.email = email;
    if (password) authUpdate.password = password;
    const { error: authError } = await service.auth.admin.updateUserById(id, authUpdate);
    if (authError) throw authError;
    const { data: profile, error: profileError } = await service.from("profiles").update({ email: email ?? existing.email, full_name: fullName, role: nextRole, active: nextActive, ...(Array.isArray(body.allowedProviderIds) ? { allowed_provider_ids: body.allowedProviderIds } : {}) }).eq("id", id).select().single();
    if (profileError) throw profileError;
    await writeAudit({ actorUserId: actor.user.id, action: "user.update", entityType: "profile", entityId: id, after: { email: email ?? existing.email, fullName, role: nextRole, active: nextActive, passwordChanged: Boolean(password) }, requestId: request.headers.get("x-request-id") });
    return NextResponse.json({ user: profile });
  } catch (cause) {
    return jsonError(cause);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const actor = await requireApiProfile(["admin"]);
    const { id } = await context.params;
    if (id === actor.user.id) throw new InputError("SELF_PROTECTION", "You cannot delete your own account", 422);
    const service = createServiceSupabaseClient();
    const { data: existing, error } = await service.from("profiles").select("id,role,active").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!existing) return jsonNotFound("User not found");
    if (existing.role === "admin" && existing.active === true && (await activeAdminCount(service)) <= 1) throw new InputError("LAST_ADMIN", "The last active administrator cannot be deleted", 422);
    const result = await service.auth.admin.deleteUser(id);
    if (result.error) throw result.error;
    await writeAudit({ actorUserId: actor.user.id, action: "user.delete", entityType: "profile", entityId: id, requestId: request.headers.get("x-request-id") });
    return NextResponse.json({ ok: true });
  } catch (cause) {
    return jsonError(cause);
  }
}
