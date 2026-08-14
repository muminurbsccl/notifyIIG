import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiProfile } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { importCommitSchema, importCommitTransportSchema } from "@/lib/validation";
import { computePreviewChecksum, verifyPreviewSignature } from "@/lib/import/xlsx";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const countSchema = z.object({ createdCircuits: z.number().int().nonnegative(), skippedCircuits: z.number().int().nonnegative(), mergedCircuits: z.number().int().nonnegative(), versionedCircuits: z.number().int().nonnegative(), invoiceCount: z.number().int().nonnegative() }).strict();
const commitSuccessSchema = z.object({ batchId: z.string().regex(uuidPattern), counts: countSchema }).strict();
const commitRejectionSchema = z.object({ status: z.literal("rejected"), batchId: z.string().regex(uuidPattern), errorCode: z.literal("IMPORT_COMMIT_FAILED") }).strict();

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
    if (data && typeof data === "object" && !Array.isArray(data) && (data as Record<string, unknown>).status === "rejected") {
      const rejected = commitRejectionSchema.safeParse(data);
      if (!rejected.success) throw new Error("Import commit returned an invalid rejection result");
      return NextResponse.json(
        {
          error: { code: "IMPORT_COMMIT_REJECTED", message: "The import was rejected; review the workbook and try again" },
          batchId: rejected.data.batchId,
        },
        { status: 422 },
      );
    }
    const committed = commitSuccessSchema.safeParse(data);
    if (!committed.success) throw new Error("Import commit returned an invalid result");
    return NextResponse.json(committed.data);
  } catch (cause) {
    return jsonError(cause);
  }
}
