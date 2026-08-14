import { classifyImportLifecycle, type CircuitImportCandidate, type ImportIssue, type ImportProvider } from "@/lib/domain/workbook-import";
import { resolveCanonicalProvider } from "@/lib/domain/provider-aliases";
import { cellText, createConsumedColumns, headerKey, isBlankRow, splitMultiline } from "@/lib/import/cell-values";
import { parseImportCost } from "@/lib/import/costs";
import { parseWorkbookDate } from "@/lib/import/dates";
import { importIdentifier, normalizeIdentifier, type SheetAdapterResult, type WorkbookSheetAdapter } from "./types";

type Section = { kind: "service" | "billing"; headers: string[] };
const findColumn = (headers: string[], ...names: string[]) => headers.findIndex((header) => names.includes(header));

export const singaporeEquinixAdapter: WorkbookSheetAdapter = {
  sheetName: "Singapore Equinix",
  parse(sheet, businessDate): SheetAdapterResult {
    const providers = new Map<string, ImportProvider>(); const circuitCandidates: CircuitImportCandidate[] = []; const issues: ImportIssue[] = [];
    let section: Section | null = null; let lastBillingCandidate: CircuitImportCandidate | null = null; let foundHeader = false;
    const parseDate = (raw: string, source: { sheetName: string; rowNumber: number }): string | null => {
      if (!raw) return null; const parsed = parseWorkbookDate(raw); if (parsed.value) return parsed.value;
      issues.push({ code: "INVALID_DATE", severity: "error", message: "Date is not in an accepted format", source, value: raw }); return null;
    };
    for (let index = 0; index < sheet.rows.length; index += 1) {
      const row = sheet.rows[index]; const headers = row.map(headerKey); const orderHeader = findColumn(headers, "service order", "service order number") >= 0;
      if (orderHeader && findColumn(headers, "expiry date", "expiry") >= 0) { section = { kind: "service", headers }; lastBillingCandidate = null; foundHeader = true; continue; }
      if (orderHeader && findColumn(headers, "monthly cost", "cost") >= 0) { section = { kind: "billing", headers }; lastBillingCandidate = null; foundHeader = true; continue; }
      if (!section || isBlankRow(row)) continue;
      const source = { sheetName: sheet.name, rowNumber: index + 1, section: section.kind };
      const at = (...names: string[]) => { const position = findColumn(section!.headers, ...names); return position < 0 ? "" : cellText(row[position]); };
      const orderValues = splitMultiline(at("service order", "service order number")); const rawCost = at("monthly cost", "cost");
      if (section.kind === "billing" && orderValues.length === 0 && rawCost && lastBillingCandidate) {
        const cost = parseImportCost(rawCost); lastBillingCandidate.monthlyCost = cost.monthlyCost; lastBillingCandidate.currency = cost.currency;
        lastBillingCandidate.rawCostDetails = cost.rawDetails;
        if (cost.rawDetails) issues.push({ code: "COMPOUND_COST", severity: "warning", message: "Monthly cost requires review", source, value: cost.rawDetails });
        continue;
      }
      if (orderValues.length === 0) { if (row.some((cell) => cellText(cell))) issues.push({ code: "MISSING_IDENTIFIER", severity: "error", message: "Equinix row has no service order", source }); continue; }
      const primary = orderValues[0]; const provider = resolveCanonicalProvider("", at("provider name", "provider") || "Equinix");
      const startDate = section.kind === "service" ? parseDate(at("activation date", "activation"), source) : null;
      const expiryDate = section.kind === "service" ? parseDate(at("expiry date", "expiry"), source) : null;
      if (startDate && expiryDate && startDate >= expiryDate) issues.push({ code: "CONTRADICTORY_DATES", severity: "error", message: "Expiry must follow activation", source });
      const cost = parseImportCost(rawCost); if (cost.rawDetails) issues.push({ code: "COMPOUND_COST", severity: "warning", message: "Monthly cost requires review", source, value: cost.rawDetails });
      const known = ["service order", "service order number", "provider name", "provider", "service type", "service", "capacity", "location", "activation date", "activation", "expiry date", "expiry", "monthly cost", "cost", "notes", "remark"];
      const tracker = createConsumedColumns(); tracker.mark(...section.headers.map((header, columnIndex) => known.includes(header) ? columnIndex : -1).filter((columnIndex) => columnIndex >= 0));
      for (const cell of tracker.unconsumed(row)) issues.push({ code: "UNMAPPED_CELL", severity: "warning", message: `Unmapped column ${cell.columnIndex + 1}`, source, value: cell.value });
      if (!provider) { issues.push({ code: "MISSING_PROVIDER", severity: "error", message: "Equinix row has no provider", source }); continue; }
      if (!providers.has(provider.code)) providers.set(provider.code, { ...provider, sources: [source] });
      const candidate: CircuitImportCandidate = {
        candidateKey: `${provider.code}:${normalizeIdentifier(primary)}`, providerCode: provider.code, providerName: provider.name,
        externalCircuitId: primary, identifierType: "durable",
        identifiers: orderValues.map((identifier, identifierIndex) => importIdentifier(identifierIndex === 0 ? "service_order" : "alternate", identifier, identifierIndex === 0)),
        serviceType: at("service type", "service") || null, capacity: at("capacity") || null, location: at("location") || null,
        segment: null, connectedRouter: null, startDate, expiryDate, renewalProcedureStartDate: null,
        monthlyCost: cost.monthlyCost, currency: cost.currency, rawCostDetails: cost.rawDetails, notes: at("notes", "remark") || null,
        ...classifyImportLifecycle(expiryDate, businessDate), sources: [source],
      };
      circuitCandidates.push(candidate); lastBillingCandidate = section.kind === "billing" ? candidate : null;
    }
    if (!foundHeader) issues.push({ code: "INVALID_SHEET_STRUCTURE", severity: "error", message: "Singapore Equinix header was not found", source: { sheetName: sheet.name, rowNumber: 1 } });
    return { providers: [...providers.values()], circuitCandidates, issues };
  },
};
