import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireApiProfile } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { InputError, jsonError, jsonNotFound } from "@/lib/http";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actorUserId: string;
  try {
    const context = await requireApiProfile(["admin", "operations_editor"]);
    actorUserId = context.user.id;
  } catch (cause) {
    return jsonError(cause);
  }

  const { id } = await params;

  let body: { reason?: unknown };
  try {
    body = (await request.json()) as { reason?: unknown };
  } catch {
    return jsonError(
      new InputError("INVALID_BODY", "Request body must be valid JSON"),
    );
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return jsonError(
      new InputError("REASON_REQUIRED", "A non-empty reason is required"),
    );
  }

  try {
    const client = createServiceSupabaseClient();
    const { data: delivery, error } = await client
      .from("notification_deliveries")
      .select("id,event_id,channel,target_hash,masked_target,idempotency_key")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!delivery) {
      return jsonNotFound("Delivery not found");
    }

    const { data: inserted, error: upsertError } = await client
      .from("notification_deliveries")
      .upsert(
        {
          event_id: delivery.event_id,
          channel: delivery.channel,
          target_hash: delivery.target_hash,
          masked_target: delivery.masked_target,
          idempotency_key: `${delivery.idempotency_key}-resend-${randomUUID()}`,
          status: "queued",
          attempts: 0,
          next_attempt_at: null,
        },
        { onConflict: "idempotency_key" },
      )
      .select("id");
    if (upsertError) throw upsertError;

    await writeAudit({
      actorUserId,
      action: "notification.resend",
      entityType: "notification_delivery",
      entityId: delivery.id,
      after: { reason, channel: delivery.channel, maskedTarget: delivery.masked_target },
    });

    return NextResponse.json({ ok: true, deliveryId: inserted?.[0]?.id });
  } catch (cause) {
    return jsonError(cause);
  }
}
