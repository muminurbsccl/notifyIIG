import type { CircuitImportCandidate, ImportIdentifier, ImportIssue, ImportProvider } from "@/lib/domain/workbook-import";

export type WorksheetGrid = { name: string; rows: readonly (readonly unknown[])[] };
export type SheetAdapterResult = { providers: ImportProvider[]; circuitCandidates: CircuitImportCandidate[]; issues: ImportIssue[] };
export interface WorkbookSheetAdapter {
  readonly sheetName: string;
  parse(sheet: WorksheetGrid, businessDate: string): SheetAdapterResult;
}

export function normalizeIdentifier(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

export function importIdentifier(kind: ImportIdentifier["kind"], value: string, primary: boolean): ImportIdentifier {
  return { kind, value: value.trim(), normalizedValue: normalizeIdentifier(value), primary };
}
