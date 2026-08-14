import { classifyImportLifecycle, type ImportIssue, type ImportProvider } from "@/lib/domain/workbook-import";
import { resolveCanonicalProvider } from "@/lib/domain/provider-aliases";
import { cellText, createConsumedColumns, headerKey } from "@/lib/import/cell-values";
import { parseImportCost } from "@/lib/import/costs";
import { parseWorkbookDate } from "@/lib/import/dates";
import { importIdentifier, normalizeIdentifier, type SheetAdapterResult, type WorkbookSheetAdapter } from "./types";

export const upstreamBackhaulAdapter: WorkbookSheetAdapter = {
  sheetName: "Upstream (Backhaul)",
  parse(sheet, businessDate): SheetAdapterResult {
    const providers = new Map<string, ImportProvider>(); const circuitCandidates: SheetAdapterResult["circuitCandidates"] = []; const issues: ImportIssue[] = [];
    const headerIndex = sheet.rows.findIndex((row) => row.map(headerKey).includes("provider id") && row.map(headerKey).includes("bscplc id"));
    if (headerIndex < 0) return { providers: [], circuitCandidates, issues: [{ code: "INVALID_SHEET_STRUCTURE", severity: "error", message: "Backhaul header was not found", source: { sheetName: sheet.name, rowNumber: 1 } }] };
    let heading = "";
    for (let index = headerIndex + 1; index < sheet.rows.length; index += 1) {
      const row = sheet.rows[index]; const source = { sheetName: sheet.name, rowNumber: index + 1 }; const first = cellText(row[0]);
      if (!/^\d+$/.test(first)) { if (first && row.slice(1).every((value) => !cellText(value))) heading = first; continue; }
      const provider = resolveCanonicalProvider(heading); if (!provider) { issues.push({ code: "MISSING_PROVIDER", severity: "error", message: "Backhaul row has no provider section", source }); continue; }
      const providerId = cellText(row[1]); const bscplcId = cellText(row[2]); const primary = bscplcId || providerId;
      if (!primary) { issues.push({ code: "MISSING_IDENTIFIER", severity: "error", message: "Backhaul row has no durable identifier", source }); continue; }
      if (!providers.has(provider.code)) providers.set(provider.code, { ...provider, sources: [source] });
      const parseDate = (raw: string): string | null => { if (!raw) return null; const parsed = parseWorkbookDate(raw); if (parsed.value) return parsed.value; issues.push({ code: "INVALID_DATE", severity: "error", message: "Date is not in an accepted format", source, value: raw }); return null; };
      const startDate = parseDate(cellText(row[6])); const expiryDate = parseDate(cellText(row[7])); const renewalProcedureStartDate = parseDate(cellText(row[9]));
      if (startDate && expiryDate && startDate >= expiryDate) issues.push({ code: "CONTRADICTORY_DATES", severity: "error", message: "Expiry must follow activation", source });
      const cost = parseImportCost(cellText(row[8])); if (cost.rawDetails) issues.push({ code: "COMPOUND_COST", severity: "warning", message: "Monthly cost requires review", source, value: cost.rawDetails });
      const identifiers = [importIdentifier(bscplcId ? "bscplc" : "provider", primary, true)]; if (bscplcId && providerId) identifiers.push(importIdentifier("provider", providerId, false));
      const location = /\(([^)]+)\)\s*$/.exec(heading)?.[1]?.trim() || null; const lifecycle = classifyImportLifecycle(expiryDate, businessDate);
      const tracker = createConsumedColumns(); tracker.mark(0, 1, 2, 3, 4, 5, 6, 7, 8, 9); for (const cell of tracker.unconsumed(row)) issues.push({ code: "UNMAPPED_CELL", severity: "warning", message: `Unmapped column ${cell.columnIndex + 1}`, source, value: cell.value });
      circuitCandidates.push({ candidateKey: `${provider.code}:${normalizeIdentifier(primary)}`, providerCode: provider.code, providerName: provider.name, externalCircuitId: primary, identifierType: "durable", identifiers,
        serviceType: "Backhaul", capacity: cellText(row[3]) || null, location, segment: cellText(row[4]) || null, connectedRouter: cellText(row[5]) || null,
        startDate, expiryDate, renewalProcedureStartDate, monthlyCost: cost.monthlyCost, currency: cost.currency, rawCostDetails: cost.rawDetails, notes: null, ...lifecycle, sources: [source] });
    }
    return { providers: [...providers.values()], circuitCandidates, issues };
  },
};
