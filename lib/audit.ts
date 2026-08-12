import "server-only";
import { redactAuditValue } from "@/lib/domain/audit-redaction";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export { redactAuditValue } from "@/lib/domain/audit-redaction";

export type AuditInput = {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
};

export async function writeAudit(input: AuditInput): Promise<void> {
  const { error } = await createServiceSupabaseClient().rpc("append_audit_log", {
    p_actor_user_id: input.actorUserId,
    p_action: input.action,
    p_entity_type: input.entityType,
    p_entity_id: input.entityId ?? null,
    p_before_json: input.before === undefined ? null : redactAuditValue(input.before),
    p_after_json: input.after === undefined ? null : redactAuditValue(input.after),
    p_request_id: input.requestId ?? null,
  });
  if (error) throw error;
}
