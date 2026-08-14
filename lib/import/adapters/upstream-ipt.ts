import { classifyImportLifecycle, type ImportIssue, type ImportProvider } from "@/lib/domain/workbook-import";
import { resolveCanonicalProvider } from "@/lib/domain/provider-aliases";
import { cellText, createConsumedColumns, headerKey } from "@/lib/import/cell-values";
import { parseImportCost } from "@/lib/import/costs";
import { parseWorkbookDate } from "@/lib/import/dates";
import { importIdentifier, normalizeIdentifier, type SheetAdapterResult, type WorkbookSheetAdapter } from "./types";

function dateValue(raw: string, source: { sheetName: string; rowNumber: number }, issues: ImportIssue[]): string | null {
  if (!raw) return null;
  const parsed = parseWorkbookDate(raw);
  if (parsed.value) return parsed.value;
  issues.push({ code: "INVALID_DATE", severity: "error", message: "Date is not in an accepted format", source, value: raw });
  return null;
}

export const upstreamIptAdapter: WorkbookSheetAdapter = {
  sheetName: "Upstream (IPT)",
  parse(sheet, businessDate): SheetAdapterResult {
    const providers = new Map<string, ImportProvider>();
    const circuitCandidates: SheetAdapterResult["circuitCandidates"] = [];
    const issues: ImportIssue[] = [];
    const headerIndex = sheet.rows.findIndex((row) => row.map(headerKey).includes("circuit id") && row.map(headerKey).includes("provider name"));
    if (headerIndex < 0) return { providers: [], circuitCandidates, issues: [{ code: "INVALID_SHEET_STRUCTURE", severity: "error", message: "IP Transit header was not found", source: { sheetName: sheet.name, rowNumber: 1 } }] };

    for (let index = headerIndex + 1; index < sheet.rows.length; index += 1) {
      const row = sheet.rows[index];
      const source = { sheetName: sheet.name, rowNumber: index + 1 };
      if (!/^\d+$/.test(cellText(row[0]))) continue;
      const circuitId = cellText(row[2]);
      const provider = resolveCanonicalProvider("", cellText(row[5]));
      if (!provider) { issues.push({ code: "MISSING_PROVIDER", severity: "error", message: "Circuit row has no provider", source }); continue; }
      if (!circuitId) { issues.push({ code: "MISSING_IDENTIFIER", severity: "error", message: "Circuit row has no circuit ID", source }); continue; }
      if (!providers.has(provider.code)) providers.set(provider.code, { ...provider, sources: [source] });
      const startDate = dateValue(cellText(row[8]), source, issues);
      const expiryDate = dateValue(cellText(row[9]), source, issues);
      const renewalProcedureStartDate = dateValue(cellText(row[10]), source, issues);
      if (startDate && expiryDate && startDate >= expiryDate) issues.push({ code: "CONTRADICTORY_DATES", severity: "error", message: "Expiry must follow activation", source });
      const cost = parseImportCost(cellText(row[12]));
      if (cost.rawDetails) issues.push({ code: "COMPOUND_COST", severity: "warning", message: "Monthly cost requires review", source, value: cost.rawDetails });
      const tracker = createConsumedColumns(); tracker.mark(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13);
      for (const cell of tracker.unconsumed(row)) issues.push({ code: "UNMAPPED_CELL", severity: "warning", message: `Unmapped column ${cell.columnIndex + 1}`, source, value: cell.value });
      const identifiers = [importIdentifier("circuit", circuitId, true)];
      const customerId = cellText(row[1]); if (customerId) identifiers.push(importIdentifier("customer_link", customerId, false));
      const lifecycle = classifyImportLifecycle(expiryDate, businessDate);
      const nrc = cellText(row[11]); const remark = cellText(row[13]);
      circuitCandidates.push({
        candidateKey: `${provider.code}:${normalizeIdentifier(circuitId)}`, providerCode: provider.code, providerName: provider.name,
        externalCircuitId: circuitId, identifierType: "circuit", identifiers,
        serviceType: cellText(row[3]) || null, capacity: cellText(row[4]) || null, location: null,
        segment: cellText(row[6]) || null, connectedRouter: cellText(row[7]) || null,
        startDate, expiryDate, renewalProcedureStartDate, monthlyCost: cost.monthlyCost, currency: cost.currency,
        rawCostDetails: cost.rawDetails, notes: [nrc && `NRC: ${nrc}`, remark].filter(Boolean).join("\n") || null,
        ...lifecycle, sources: [source],
      });
    }
    return { providers: [...providers.values()], circuitCandidates, issues };
  },
};
