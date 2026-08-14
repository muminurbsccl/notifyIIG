import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import * as XLSX from "xlsx";
import type { ImportIssue, ImportPreview } from "@/lib/domain/workbook-import";
import { InputError } from "@/lib/http";
import { getWorkbookSheetAdapter } from "@/lib/import/adapters";
import type { SheetAdapterResult } from "@/lib/import/adapters/types";
import { mergeAdapterResults } from "@/lib/import/merge-preview";
import { getServerConfig } from "@/lib/server-config";

export const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024;
export const PREVIEW_LIFETIME_MS = 30 * 60 * 1000;

export type WorkbookPreview = ImportPreview & {
  filename: string;
  checksum: string;
  previewChecksum: string;
  previewSignature: string;
  previewIssuedAt: string;
  sheetNames: string[];
};

function digest(value: string | ArrayBuffer): string {
  const input = typeof value === "string" ? value : Buffer.from(value);
  return createHash("sha256").update(input).digest("hex");
}

export function computePreviewChecksum(preview: unknown): string {
  return digest(JSON.stringify(preview));
}

function previewSecret(): string {
  const secret = getServerConfig().appEncryptionKey;
  if (!secret) throw new InputError("PREVIEW_SIGNING_NOT_CONFIGURED", "Import preview signing is not configured", 503);
  return secret;
}

export function computePreviewSignature(previewChecksum: string, fileChecksum: string, filename: string, sheetNames: string[], previewIssuedAt = ""): string {
  const metadata = JSON.stringify({ filename, sheetNames, previewIssuedAt });
  return createHmac("sha256", previewSecret()).update(`${fileChecksum}:${previewChecksum}:${metadata}`).digest("hex");
}

export function isPreviewFresh(previewIssuedAt: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(previewIssuedAt)) return false;
  const issuedAt = Date.parse(previewIssuedAt);
  const nowTime = now.getTime();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(nowTime)) return false;
  if (new Date(issuedAt).toISOString() !== previewIssuedAt) return false;
  const age = nowTime - issuedAt;
  return age >= 0 && age < PREVIEW_LIFETIME_MS;
}

export function verifyPreviewSignature(previewChecksum: string, fileChecksum: string, signature: string, filename: string, sheetNames: string[], previewIssuedAt = "", now = new Date()): boolean {
  previewSecret();
  try {
    if (!isPreviewFresh(previewIssuedAt, now)) return false;
    const expected = Buffer.from(computePreviewSignature(previewChecksum, fileChecksum, filename, sheetNames, previewIssuedAt), "hex");
    const received = Buffer.from(signature, "hex");
    return expected.length === received.length && timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

function dhakaBusinessDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function worksheetRows(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "", blankrows: true });
}

export async function parseWorkbook(file: File, now = new Date()): Promise<WorkbookPreview> {
  if (file.size > MAX_WORKBOOK_BYTES) {
    throw new InputError("FILE_TOO_LARGE", "Workbook exceeds the 5 MB upload limit");
  }
  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    throw new InputError("UNSUPPORTED_FILE", "Only XLSX or XLS workbooks are accepted");
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const isXlsx = /\.xlsx$/i.test(file.name);
  const validSignature = isXlsx
    ? bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b
    : bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (!validSignature) throw new InputError("INVALID_WORKBOOK", "The workbook could not be parsed", 422);
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "array", cellFormula: false, cellNF: false, cellText: true, bookVBA: false });
  } catch {
    throw new InputError("INVALID_WORKBOOK", "The workbook could not be parsed", 422);
  }
  const sheetNames = workbook.SheetNames;
  if (sheetNames.length === 0) throw new InputError("EMPTY_WORKBOOK", "Workbook contains no worksheets");
  const adapterResults: SheetAdapterResult[] = [];
  const orchestrationIssues: ImportIssue[] = [];
  const businessDate = dhakaBusinessDate(now);
  let approvedSheetCount = 0;
  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = worksheetRows(sheet);
    if (sheetName === "Sheet1") {
      orchestrationIssues.push({ code: "IGNORED_HELPER_SHEET", severity: "info", message: "Helper Sheet1 was ignored", source: { sheetName, rowNumber: 1 } });
      continue;
    }
    const adapter = getWorkbookSheetAdapter(sheetName);
    if (adapter) { approvedSheetCount += 1; adapterResults.push(adapter.parse({ name: sheetName, rows }, businessDate)); continue; }
    if (rows.some((row) => row.some((cell) => String(cell ?? "").trim()))) {
      orchestrationIssues.push({ code: "UNKNOWN_WORKSHEET", severity: "warning", message: "Unknown non-empty worksheet requires review", source: { sheetName, rowNumber: 1 } });
    }
  }
  if (approvedSheetCount === 0) throw new InputError("NO_APPROVED_WORKSHEETS", "Workbook contains no approved operational worksheets", 422);
  if (orchestrationIssues.length) adapterResults.push({ providers: [], circuitCandidates: [], issues: orchestrationIssues });
  const preview = mergeAdapterResults(adapterResults);
  const checksum = digest(buffer);
  const previewChecksum = computePreviewChecksum(preview);
  const previewIssuedAt = now.toISOString();
  return {
    ...preview,
    filename: file.name,
    checksum,
    previewChecksum,
    previewSignature: computePreviewSignature(previewChecksum, checksum, file.name, sheetNames, previewIssuedAt),
    previewIssuedAt,
    sheetNames,
  };
}
