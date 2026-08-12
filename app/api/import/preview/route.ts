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
    return NextResponse.json({ preview: await parseWorkbook(file) });
  } catch (cause) {
    return jsonError(cause);
  }
}
