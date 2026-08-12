import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { jsonError, jsonForbidden, jsonNotFound } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { circuitPatchSchema, normalizeCircuitId, providerManagerCircuitPatchSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };

function activationError(row: Record<string, unknown>): string | null {
  if (!["active", "renewal_pending"].includes(String(row.status))) return null;
  if (!row.expiry_date) return "A verified expiry date is required before activation";
  if (!row.owner_user_id && !row.owner_override) return "A responsible officer is required before activation";
  if (!row.verified_at) return "Activation requires a verified expiry date";
  return null;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await requireApiProfile();
    const { id } = await context.params;
    const { data, error } = await auth.supabase.from("circuits").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return jsonNotFound("Circuit not found");
    return NextResponse.json({ circuit: data });
  } catch (cause) {
    return jsonError(cause);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireApiProfile();
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const managerKeys = new Set(["actionStatus", "notes"]);
    if (auth.profile.role === "provider_manager" && Object.keys(body).some((key) => !managerKeys.has(key))) {
      return jsonForbidden("Provider managers may update renewal action and notes only");
    }

    const beforeResult = await auth.supabase.from("circuits").select("*").eq("id", id).maybeSingle();
    if (beforeResult.error) throw beforeResult.error;
    if (!beforeResult.data) return jsonNotFound("Circuit not found");
    const before = beforeResult.data as Record<string, unknown>;

    if (auth.profile.role === "provider_manager") {
      const input = providerManagerCircuitPatchSchema.parse(body);
      const { data, error } = await auth.supabase.rpc("update_circuit_action", {
        target_circuit_id: id,
        new_action_status: input.actionStatus ?? before.action_status,
        new_notes: input.notes,
      });
      if (error) throw error;
      await writeAudit({ actorUserId: auth.user.id, action: "circuit.action.update", entityType: "circuit", entityId: id, before, after: data, requestId: request.headers.get("x-request-id") });
      return NextResponse.json({ circuit: data });
    }

    if (!(["admin", "operations_editor"] as string[]).includes(auth.profile.role)) {
      return jsonForbidden();
    }
    const input = circuitPatchSchema.parse(body);
    const merged: Record<string, unknown> = {
      providerId: input.providerId ?? before.provider_id,
      externalCircuitId: input.externalCircuitId ?? before.external_circuit_id,
      identifierType: input.identifierType ?? before.identifier_type,
      serviceType: input.serviceType === undefined ? before.service_type : input.serviceType,
      capacity: input.capacity === undefined ? before.capacity : input.capacity,
      location: input.location === undefined ? before.location : input.location,
      startDate: input.startDate === undefined ? before.start_date : input.startDate,
      expiryDate: input.expiryDate === undefined ? before.expiry_date : input.expiryDate,
      status: input.status ?? before.status,
      actionStatus: input.actionStatus ?? before.action_status,
      ownerUserId: input.ownerUserId === undefined ? before.owner_user_id : input.ownerUserId,
      ownerOverride: input.ownerOverride === undefined ? before.owner_override : input.ownerOverride,
      backupOwnerUserId: input.backupOwnerUserId === undefined ? before.backup_owner_user_id : input.backupOwnerUserId,
      monthlyCost: input.monthlyCost === undefined ? before.monthly_cost : input.monthlyCost,
      currency: input.currency === undefined ? before.currency : input.currency,
      notes: input.notes === undefined ? before.notes : input.notes,
      notificationEnabled: input.notificationEnabled === undefined ? before.notification_enabled : input.notificationEnabled,
      notificationRuleId: input.notificationRuleId === undefined ? before.notification_rule_id : input.notificationRuleId,
    };
    const expiryChanged = merged.expiryDate !== before.expiry_date;
    if (merged.startDate && merged.expiryDate && String(merged.expiryDate) <= String(merged.startDate)) {
      return NextResponse.json({ error: { code: "INVALID_DATE_RANGE", message: "Expiry date must be after start date" } }, { status: 400 });
    }
    const verify = input.verify === true;
    if (expiryChanged && !verify) {
      return NextResponse.json({ error: { code: "RENEWAL_REQUIRES_VERIFICATION", message: "A changed expiry date must be explicitly verified before saving" } }, { status: 422 });
    }
    if (verify) {
      merged.verifiedAt = new Date().toISOString();
      merged.verifiedBy = auth.user.id;
    } else {
      merged.verifiedAt = before.verified_at;
      merged.verifiedBy = before.verified_by;
    }
    const row = {
      provider_id: merged.providerId,
      external_circuit_id: merged.externalCircuitId,
      normalized_circuit_id: normalizeCircuitId(String(merged.externalCircuitId)),
      identifier_type: merged.identifierType,
      service_type: merged.serviceType,
      capacity: merged.capacity,
      location: merged.location,
      start_date: merged.startDate,
      expiry_date: merged.expiryDate,
      status: merged.status,
      action_status: merged.actionStatus,
      owner_user_id: merged.ownerUserId,
      owner_override: merged.ownerOverride,
      backup_owner_user_id: merged.backupOwnerUserId,
      monthly_cost: merged.monthlyCost,
      currency: merged.currency,
      notes: merged.notes,
      notification_enabled: merged.notificationEnabled,
      notification_rule_id: merged.notificationRuleId,
      verified_at: merged.verifiedAt,
      verified_by: merged.verifiedBy,
      ...(expiryChanged ? { expiry_version: Number(before.expiry_version) + 1 } : {}),
    };
    const errorMessage = activationError({ ...row });
    if (errorMessage) return NextResponse.json({ error: { code: "ACTIVATION_REQUIRES_VERIFICATION", message: errorMessage } }, { status: 422 });
    const { data, error } = await auth.supabase.from("circuits").update(row).eq("id", id).select().single();
    if (error) throw error;

    await writeAudit({ actorUserId: auth.user.id, action: expiryChanged ? "circuit.renewal.update" : "circuit.update", entityType: "circuit", entityId: id, before, after: data, requestId: request.headers.get("x-request-id") });
    return NextResponse.json({ circuit: data });
  } catch (cause) {
    return jsonError(cause);
  }
}
