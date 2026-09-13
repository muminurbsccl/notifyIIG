import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { InputError, jsonError, jsonNotFound } from "@/lib/http";
import { providerInputSchema } from "@/lib/validation";
import { writeAudit } from "@/lib/audit";

type RouteContext = { params: Promise<{ id: string }> };

const FOREIGN_KEY_VIOLATION = "23503";

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await requireApiProfile();
    const { id } = await context.params;
    const { data, error } = await auth.supabase.from("providers").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return jsonNotFound("Provider not found");
    return NextResponse.json({ provider: data });
  } catch (cause) {
    return jsonError(cause);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireApiProfile(["admin", "operations_editor"]);
    const { id } = await context.params;
    const input = providerInputSchema.partial().parse(await request.json());
    const beforeResult = await auth.supabase.from("providers").select("*").eq("id", id).maybeSingle();
    if (beforeResult.error) throw beforeResult.error;
    if (!beforeResult.data) return jsonNotFound("Provider not found");
    const row = {
      ...(input.code === undefined ? {} : { code: input.code }),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.active === undefined ? {} : { active: input.active }),
      ...(input.defaultResponsibleOfficer === undefined ? {} : { default_responsible_officer: input.defaultResponsibleOfficer }),
      ...(input.primaryOwnerUserId === undefined ? {} : { primary_owner_user_id: input.primaryOwnerUserId }),
      ...(input.backupOwnerUserId === undefined ? {} : { backup_owner_user_id: input.backupOwnerUserId }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    };
    const effectiveActive = input.active === undefined ? beforeResult.data.active : input.active;
    const effectiveOwner = input.primaryOwnerUserId === undefined ? beforeResult.data.primary_owner_user_id : input.primaryOwnerUserId;
    const effectiveDraftOwner = input.defaultResponsibleOfficer === undefined ? beforeResult.data.default_responsible_officer : input.defaultResponsibleOfficer;
    if (effectiveActive && !effectiveOwner && !effectiveDraftOwner) {
      return NextResponse.json({ error: { code: "OWNER_REQUIRED", message: "An active provider needs a primary responsible officer" } }, { status: 422 });
    }
    const { data, error } = await auth.supabase.from("providers").update(row).eq("id", id).select().single();
    if (error) throw error;
    await writeAudit({ actorUserId: auth.user.id, action: "provider.update", entityType: "provider", entityId: id, before: beforeResult.data, after: data, requestId: request.headers.get("x-request-id") });
    return NextResponse.json({ provider: data });
  } catch (cause) {
    return jsonError(cause);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const auth = await requireApiProfile(["admin", "operations_editor"]);
    const { id } = await context.params;
    const beforeResult = await auth.supabase.from("providers").select("*").eq("id", id).maybeSingle();
    if (beforeResult.error) throw beforeResult.error;
    if (!beforeResult.data) return jsonNotFound("Provider not found");

    const { error } = await auth.supabase.from("providers").delete().eq("id", id);
    if (error) {
      if (error.code === FOREIGN_KEY_VIOLATION) {
        throw new InputError("PROVIDER_HAS_CIRCUITS", "This provider still has circuits registered against it. Remove or reassign them before deleting the provider", 409);
      }
      throw error;
    }
    await writeAudit({ actorUserId: auth.user.id, action: "provider.delete", entityType: "provider", entityId: id, before: beforeResult.data, requestId: request.headers.get("x-request-id") });
    return NextResponse.json({ ok: true });
  } catch (cause) {
    return jsonError(cause);
  }
}
