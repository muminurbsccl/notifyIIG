import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { importCommitSchema } from "@/lib/validation";
import { computePreviewChecksum, verifyPreviewSignature } from "@/lib/import/xlsx";
import { canonicalCircuitId } from "@/lib/domain/import-normalizer";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

const approvedCountKeys = ["createdCircuits", "skippedCircuits", "mergedCircuits", "versionedCircuits", "invoiceCount"] as const;

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
    const input = importCommitSchema.parse(payload);
    const candidateKeys = new Set(input.preview.circuitCandidates.map((candidate) => `${candidate.providerName.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "")}:${canonicalCircuitId(candidate.externalCircuitId)}`));
    for (const key of Object.keys(input.decisions)) {
      if (!candidateKeys.has(key)) {
        return NextResponse.json({ error: { code: "UNKNOWN_IMPORT_DECISION", message: `Import decision does not match a preview candidate: ${key}` } }, { status: 422 });
      }
    }
    for (const issue of input.preview.issues.filter((item) => item.code === "DUPLICATE_IDENTIFIER")) {
      if (!issue.decisionKey || !input.decisions[issue.decisionKey]) {
        return NextResponse.json({ error: { code: "DUPLICATE_DECISION_REQUIRED", message: "Every duplicate identifier requires skip, merge, or create review" } }, { status: 422 });
      }
    }
    if (
      computePreviewChecksum(input.preview) !== input.previewChecksum ||
      !verifyPreviewSignature(input.previewChecksum, input.checksum, input.previewSignature, input.filename, input.sheetNames)
    ) {
      return NextResponse.json(
        { error: { code: "PREVIEW_CHANGED", message: "The preview changed or expired; upload and review the workbook again" } },
        { status: 422 },
      );
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
      return NextResponse.json(
        {
          error: { code: "IMPORT_COMMIT_REJECTED", message: "The import was rejected; review the workbook and try again" },
          batchId: result.batchId,
          issues: input.preview.issues,
        },
        { status: 422 },
      );
    }
    const counts = parseCommitCounts(result.counts);
    if (typeof result.batchId !== "string" || !counts) {
      throw new Error("Import commit returned an invalid result");
    }
    return NextResponse.json({ batchId: result.batchId, counts, issues: input.preview.issues });
  } catch (cause) {
    return jsonError(cause);
  }
}
