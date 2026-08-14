import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { parseWorkbook } from "@/lib/import/xlsx";

export async function POST(request: Request) {
  try {
    await requireApiProfile(["admin", "operations_editor"]);
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
    const { filename, checksum, previewChecksum, previewSignature, previewIssuedAt, sheetNames, providers, circuitCandidates, issues, summary } = parsed;
    return NextResponse.json({ preview: { filename, checksum, previewChecksum, previewSignature, previewIssuedAt, sheetNames, providers, circuitCandidates, issues, summary } });
  } catch (cause) {
    return jsonError(cause);
  }
}
