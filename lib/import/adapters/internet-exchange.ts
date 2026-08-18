import { classifyImportLifecycle, type ImportIssue, type ImportProvider } from "@/lib/domain/workbook-import";
import { resolveCanonicalProvider } from "@/lib/domain/provider-aliases";
import { cellText, createConsumedColumns, headerKey } from "@/lib/import/cell-values";
import { parseImportCost } from "@/lib/import/costs";
import { parseWorkbookDate } from "@/lib/import/dates";
import { importIdentifier, normalizeIdentifier, type SheetAdapterResult, type WorkbookSheetAdapter } from "./types";

function column(headers: string[], ...names: string[]): number {
  return headers.findIndex((header) => names.includes(header));
}

function permissionExpiryKey(key: string): boolean {
  return key === "permission expiry" || key === "permission expiration" || key === "permission expiry date" || key === "permission expiration date";
}

export const internetExchangeAdapter: WorkbookSheetAdapter = {
  sheetName: "Internet Exchange",
  parse(sheet, businessDate): SheetAdapterResult {
    const providers = new Map<string, ImportProvider>();
    const circuitCandidates: SheetAdapterResult["circuitCandidates"] = [];
    const issues: ImportIssue[] = [];
    const headerIndex = sheet.rows.findIndex((row) => {
      const keys = row.map(headerKey);
      return keys.includes("circuit id") && keys.some(permissionExpiryKey);
    });
    if (headerIndex < 0) return { providers: [], circuitCandidates, issues: [{ code: "INVALID_SHEET_STRUCTURE", severity: "error", message: "Internet Exchange header was not found", source: { sheetName: sheet.name, rowNumber: 1 } }] };

    const headers = sheet.rows[headerIndex].map(headerKey);
    const indexes = {
      serial: column(headers, "sl", "serial", "serial no", "sl no"), customer: column(headers, "customer link id", "customer id", "link id", "link name customer id"),
      circuit: column(headers, "circuit id"), provider: column(headers, "provider name", "provider"), service: column(headers, "service type", "service", "link type"),
      capacity: column(headers, "capacity"), activation: column(headers, "activation date", "activation"), deactivation: column(headers, "deactivation", "deactivation date"),
      permissionExpiry: column(headers, "permission expiry", "permission expiration", "permission expiry date", "permission expiration date"),
      procedure: column(headers, "procedure start", "renewal procedure start", "renewal procedure start date", "starting date renewal or termination procedure"),
      cost: column(headers, "monthly cost", "cost", "monthly mrc (in usd)", "mrc (usd)"), remark: column(headers, "remark", "remarks", "notes"),
      segment: column(headers, "segment", "segment name"), router: column(headers, "connected router", "router"),
    };
    const consumed = Object.values(indexes).filter((value) => value >= 0);
    const value = (row: readonly unknown[], index: number) => index < 0 ? "" : cellText(row[index]);
    const parseDate = (raw: string, source: { sheetName: string; rowNumber: number }): string | null => {
      if (!raw) return null;
      const parsed = parseWorkbookDate(raw);
      if (parsed.value) return parsed.value;
      issues.push({ code: "INVALID_DATE", severity: "error", message: "Date is not in an accepted format", source, value: raw });
      return null;
    };

    for (let index = headerIndex + 1; index < sheet.rows.length; index += 1) {
      const row = sheet.rows[index]; const source = { sheetName: sheet.name, rowNumber: index + 1 };
      if (row.every((cell) => !cellText(cell))) continue;
      if (cellText(row[0]) && row.slice(1).every((cell) => !cellText(cell))) continue;
      const rowHeaders = row.map(headerKey);
      if (rowHeaders.includes("circuit id") && rowHeaders.some(permissionExpiryKey)) {
        issues.push({ code: "REPEATED_HEADER", severity: "warning", message: "Repeated Internet Exchange header was ignored", source });
        continue;
      }
      const circuitId = value(row, indexes.circuit); const provider = resolveCanonicalProvider("", value(row, indexes.provider));
      if (!provider) issues.push({ code: "MISSING_PROVIDER", severity: "error", message: "Internet Exchange row has no provider", source });
      if (!circuitId) issues.push({ code: "MISSING_IDENTIFIER", severity: "error", message: "Internet Exchange row has no circuit ID", source });
      const startDate = parseDate(value(row, indexes.activation), source);
      const expiryDate = parseDate(value(row, indexes.permissionExpiry), source);
      const renewalProcedureStartDate = parseDate(value(row, indexes.procedure), source);
      if (startDate && expiryDate && startDate >= expiryDate) issues.push({ code: "CONTRADICTORY_DATES", severity: "error", message: "Permission expiry must follow activation", source });
      if (renewalProcedureStartDate && expiryDate && renewalProcedureStartDate > expiryDate) issues.push({ code: "CONTRADICTORY_DATES", severity: "error", message: "Procedure start cannot follow permission expiry", source });
      const cost = parseImportCost(value(row, indexes.cost));
      if (cost.rawDetails) issues.push({ code: "COMPOUND_COST", severity: "warning", message: "Monthly cost requires review", source, value: cost.rawDetails });
      const costColumn = headers[indexes.cost];
      const currency = cost.currency ?? (cost.monthlyCost !== null && costColumn === "monthly mrc (in usd)" ? "USD" : null);
      const tracker = createConsumedColumns(); tracker.mark(...consumed);
      for (const cell of tracker.unconsumed(row)) issues.push({ code: "UNMAPPED_CELL", severity: "warning", message: `Unmapped column ${cell.columnIndex + 1}`, source, value: cell.value });
      if (!provider || !circuitId) continue;
      if (!providers.has(provider.code)) providers.set(provider.code, { ...provider, sources: [source] });
      const identifiers = [importIdentifier("circuit", circuitId, true)];
      const customer = value(row, indexes.customer); if (customer) identifiers.push(importIdentifier("customer_link", customer.split("\n")[0].trim(), false));
      const deactivation = value(row, indexes.deactivation); const remark = value(row, indexes.remark);
      circuitCandidates.push({
        candidateKey: `${provider.code}:${normalizeIdentifier(circuitId)}`, providerCode: provider.code, providerName: provider.name,
        externalCircuitId: circuitId, identifierType: "circuit", identifiers,
        serviceType: value(row, indexes.service) || null, capacity: value(row, indexes.capacity) || null,
        location: null, segment: value(row, indexes.segment) || null, connectedRouter: value(row, indexes.router) || null,
        startDate, expiryDate, renewalProcedureStartDate,
        monthlyCost: cost.monthlyCost, currency, rawCostDetails: cost.rawDetails,
        notes: [deactivation && `Deactivation: ${deactivation}`, remark].filter(Boolean).join("\n") || null,
        ...classifyImportLifecycle(expiryDate, businessDate), sources: [source],
      });
    }
    return { providers: [...providers.values()], circuitCandidates, issues };
  },
};
