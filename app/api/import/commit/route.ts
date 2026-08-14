import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { importCommitSchema, importCommitTransportSchema } from "@/lib/validation";
import { computePreviewChecksum, verifyPreviewSignature } from "@/lib/import/xlsx";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

const approvedCountKeys = ["createdCircuits", "skippedCircuits", "mergedCircuits", "versionedCircuits", "invoiceCount"] as const;
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function parseCommitCounts(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== approvedCountKeys.length) return null;
  const counts: Record<string, number> = {};
  for (const key of approvedCountKeys) {
    const number = record[key];
    if (typeof number !== "number" || !Number.isFinite(number) || !Number.isInteger(number) || number < 0) return null;
    counts[key] = number;
  }
  return counts;
}

export async function POST(request: Request) {
  try {
    const auth = await requireApiProfile(["admin", "operations_editor"]);
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON" } }, { status: 400 });
    }
    const transport = importCommitTransportSchema.parse(payload);
    if (
      computePreviewChecksum(transport.preview) !== transport.previewChecksum ||
      !verifyPreviewSignature(transport.previewChecksum, transport.checksum, transport.previewSignature, transport.filename, transport.sheetNames, transport.previewIssuedAt)
    ) {
      return NextResponse.json(
        { error: { code: "PREVIEW_CHANGED", message: "The preview changed or expired; upload and review the workbook again" } },
        { status: 422 },
      );
    }
    const input = importCommitSchema.parse(payload);
    if (input.preview.issues.some((issue) => issue.severity === "error")) {
      return NextResponse.json({ error: { code: "IMPORT_PREVIEW_BLOCKED", message: "Resolve all blocking preview issues before commit" } }, { status: 422 });
    }

    const service = createServiceSupabaseClient();
    const { data, error } = await service.rpc("commit_import_batch", {
      p_actor_user_id: auth.user.id,
      p_filename: input.filename,
      p_checksum: input.checksum,
      p_sheet_names: input.sheetNames,
      p_preview: input.preview,
      p_decisions: input.decisions,
    });
    if (error) throw error;
    const result = (data ?? {}) as Record<string, unknown>;
    if (result.status === "rejected") {
      if (typeof result.batchId !== "string" || !uuidPattern.test(result.batchId)) throw new Error("Import commit returned an invalid rejection result");
      return NextResponse.json(
        {
          error: { code: "IMPORT_COMMIT_REJECTED", message: "The import was rejected; review the workbook and try again" },
          batchId: result.batchId,
        },
        { status: 422 },
      );
    }
    const counts = parseCommitCounts(result.counts);
    if (typeof result.batchId !== "string" || !uuidPattern.test(result.batchId) || !counts) {
      throw new Error("Import commit returned an invalid result");
    }
    return NextResponse.json({ batchId: result.batchId, counts });
  } catch (cause) {
    return jsonError(cause);
  }
}
