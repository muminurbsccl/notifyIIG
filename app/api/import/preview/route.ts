import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { findExistingImportCandidateKeys } from "@/lib/data";
import { jsonError } from "@/lib/http";
import { computePreviewChecksum, computePreviewSignature, parseWorkbook } from "@/lib/import/xlsx";
import { workbookImportPreviewSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const auth = await requireApiProfile(["admin", "operations_editor"]);
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: { code: "FILE_REQUIRED", message: "Upload an XLSX workbook" } }, { status: 400 });
    }
    const file = formData.get("file");
    if (!file || typeof file !== "object" || typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== "function") {
      return NextResponse.json({ error: { code: "FILE_REQUIRED", message: "Upload an XLSX workbook" } }, { status: 400 });
    }
    const parsed = await parseWorkbook(file);
    const normalizedResult = workbookImportPreviewSchema.safeParse({ providers: parsed.providers, circuitCandidates: parsed.circuitCandidates, issues: parsed.issues, summary: parsed.summary });
    if (!normalizedResult.success) throw new Error("Workbook parser returned an invalid preview");
    const normalized = normalizedResult.data;
    const existingKeys = await findExistingImportCandidateKeys(auth.supabase, normalized.circuitCandidates);
    const enrichedResult = workbookImportPreviewSchema.safeParse({ ...normalized, issues: [...normalized.issues,
      ...normalized.circuitCandidates.filter((candidate) => existingKeys.has(candidate.candidateKey)).map((candidate) => ({
        code: "EXISTING_RECORD_COLLISION" as const, severity: "warning" as const,
        message: "An existing circuit uses this provider and primary identifier; choose skip, merge, or create",
        source: candidate.sources[0], decisionKey: candidate.candidateKey,
      })),
    ] });
    if (!enrichedResult.success) throw new Error("Workbook collision enrichment returned an invalid preview");
    const preview = enrichedResult.data;
    const previewChecksum = computePreviewChecksum(preview);
    const previewSignature = computePreviewSignature(previewChecksum, parsed.checksum, parsed.filename, parsed.sheetNames, parsed.previewIssuedAt);
    return NextResponse.json({ preview: {
      filename: parsed.filename, checksum: parsed.checksum, previewChecksum, previewSignature,
      previewIssuedAt: parsed.previewIssuedAt, sheetNames: parsed.sheetNames, ...preview,
    } });
  } catch (cause) {
    return jsonError(cause);
  }
}
