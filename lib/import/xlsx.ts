import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import * as XLSX from "xlsx";
import { normalizeWorkbookRows, type ImportPreview } from "@/lib/domain/import-normalizer";
import { InputError } from "@/lib/http";
import { getServerConfig } from "@/lib/server-config";

export const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024;

export type WorkbookPreview = ImportPreview & {
  filename: string;
  checksum: string;
  previewChecksum: string;
  previewSignature: string;
  sheetNames: string[];
};

function digest(value: string | ArrayBuffer): string {
  const input = typeof value === "string" ? value : Buffer.from(value);
  return createHash("sha256").update(input).digest("hex");
}

export function computePreviewChecksum(preview: ImportPreview): string {
  return digest(JSON.stringify(preview));
}

function previewSecret(): string {
  const secret = getServerConfig().appEncryptionKey;
  if (!secret) throw new InputError("PREVIEW_SIGNING_NOT_CONFIGURED", "Import preview signing is not configured", 503);
  return secret;
}

export function computePreviewSignature(previewChecksum: string, fileChecksum: string, filename: string, sheetNames: string[]): string {
  const metadata = JSON.stringify({ filename, sheetNames });
  return createHmac("sha256", previewSecret()).update(`${fileChecksum}:${previewChecksum}:${metadata}`).digest("hex");
}

export function verifyPreviewSignature(previewChecksum: string, fileChecksum: string, signature: string, filename: string, sheetNames: string[]): boolean {
  previewSecret();
  try {
    const expected = Buffer.from(computePreviewSignature(previewChecksum, fileChecksum, filename, sheetNames), "hex");
    const received = Buffer.from(signature, "hex");
    return expected.length === received.length && timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

export async function parseWorkbook(file: File): Promise<WorkbookPreview> {
  if (file.size > MAX_WORKBOOK_BYTES) {
    throw new InputError("FILE_TOO_LARGE", "Workbook exceeds the 5 MB upload limit");
  }
  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    throw new InputError("UNSUPPORTED_FILE", "Only XLSX or XLS workbooks are accepted");
  }

  const buffer = await file.arrayBuffer();
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "array", cellFormula: false, cellNF: false, cellText: true, bookVBA: false });
  } catch {
    throw new InputError("INVALID_WORKBOOK", "The workbook could not be parsed", 422);
  }
  const sheetNames = workbook.SheetNames;
  const firstSheet = sheetNames[0];
  if (!firstSheet) throw new InputError("EMPTY_WORKBOOK", "Workbook contains no worksheets");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheet], {
    header: 1,
    raw: false,
    defval: "",
    blankrows: true,
  });
  if (rows.length === 0 || rows.every((row) => !row.some((cell) => String(cell ?? "").trim()))) {
    throw new InputError("EMPTY_WORKSHEET", "The first worksheet contains no data", 422);
  }
  const preview = normalizeWorkbookRows(rows, firstSheet);
  if (sheetNames.some((name) => name.toLowerCase() === "sheet2")) {
    preview.issues.push({
      code: "UNSUPPORTED_SHEET",
      message: "Sheet2 is retained for manual review and is not imported automatically",
      source: { sheetName: "Sheet2", rowNumber: 1 },
    });
  }
  const checksum = digest(buffer);
  const previewChecksum = computePreviewChecksum(preview);
  return {
    ...preview,
    filename: file.name,
    checksum,
    previewChecksum,
    previewSignature: computePreviewSignature(previewChecksum, checksum, file.name, sheetNames),
    sheetNames,
  };
}
