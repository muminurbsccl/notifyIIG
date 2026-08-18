import { classifyImportLifecycle, type CircuitImportCandidate, type ImportIssue, type ImportProvider } from "@/lib/domain/workbook-import";
import { resolveCanonicalProvider } from "@/lib/domain/provider-aliases";
import { cellText, createConsumedColumns, headerKey, isBlankRow, splitMultiline } from "@/lib/import/cell-values";
import { parseImportCost } from "@/lib/import/costs";
import { parseWorkbookDate } from "@/lib/import/dates";
import { importIdentifier, normalizeIdentifier, type SheetAdapterResult, type WorkbookSheetAdapter } from "./types";

type Section = { kind: "service" | "billing"; headers: string[] };
const findColumn = (headers: string[], ...names: string[]) => headers.findIndex((header) => names.includes(header));
const orderHeaderKeys = ["service order", "service order number", "service order no with price in usd", "circuit serial no", "circuit serial number"];
const serviceExpiryKeys = ["expiry date", "expiry", "deactivation date", "order validity"];
const billingCostKeys = ["monthly cost", "cost", "mrc (usd)"];

function stripOrderPrice(value: string): string {
  return value.replace(/\s*\([^)]*\)/g, " ").replace(/\s*-\s+[A-Za-z].*$/, "").trim();
}

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
      const row = sheet.rows[index]; const headers = row.map(headerKey);
      const orderHeader = headers.some((header) => orderHeaderKeys.includes(header));
      if (orderHeader && headers.some((header) => serviceExpiryKeys.includes(header))) { section = { kind: "service", headers }; lastBillingCandidate = null; foundHeader = true; continue; }
      if (orderHeader && headers.some((header) => billingCostKeys.includes(header))) { section = { kind: "billing", headers }; lastBillingCandidate = null; foundHeader = true; continue; }
      if (!section || isBlankRow(row)) continue;
      const source = { sheetName: sheet.name, rowNumber: index + 1, section: section.kind };
      const at = (...names: string[]) => { const position = findColumn(section!.headers, ...names); return position < 0 ? "" : cellText(row[position]); };
      const rawOrderValues = splitMultiline(at(...orderHeaderKeys)).map(stripOrderPrice);
      const rawCost = at("monthly cost", "cost", "mrc (usd)");
      const known = ["service order", "service order number", "service order no with price in usd", "provider name", "provider", "service type", "service", "type of service", "capacity", "location", "activation date", "activation", "expiry date", "expiry", "deactivation date", "order validity", "starting date renewal or termination procedure", "monthly cost", "cost", "mrc (usd)", "nrc (usd)", "circuit serial no", "circuit serial number", "description", "notes", "remark", "sl", "sl no"];
      const knownIndexes = section.headers.map((header, columnIndex) => known.includes(header) ? columnIndex : -1).filter((columnIndex) => columnIndex >= 0);
      const tracker = createConsumedColumns(); tracker.mark(...knownIndexes);
      for (const cell of tracker.unconsumed(row)) issues.push({ code: "UNMAPPED_CELL", severity: "warning", message: `Unmapped column ${cell.columnIndex + 1}`, source, value: cell.value });
      const costIndex = findColumn(section.headers, "monthly cost", "cost", "mrc (usd)");
      const descriptionIndex = findColumn(section.headers, "description");
      const remarkIndex = findColumn(section.headers, "remark", "notes");
      const nrcIndex = findColumn(section.headers, "nrc (usd)");
      const populatedIndexes = row.map((cell, columnIndex) => cellText(cell) ? columnIndex : -1).filter((columnIndex) => columnIndex >= 0);
      const continuationAllowed = [costIndex, descriptionIndex, remarkIndex].filter((columnIndex) => columnIndex >= 0);
      const isContinuation = section.kind === "billing" && rawOrderValues.length === 0 && Boolean(rawCost) && Boolean(lastBillingCandidate)
        && populatedIndexes.every((columnIndex) => continuationAllowed.includes(columnIndex));
      if (isContinuation && lastBillingCandidate) {
        const cost = parseImportCost(rawCost);
        const extra = [at("description"), at("remark", "notes"), cost.rawDetails ? `Additional cost: ${rawCost}` : ""].filter(Boolean).join("\n");
        lastBillingCandidate.notes = [lastBillingCandidate.notes, extra].filter(Boolean).join("\n") || null;
        if (cost.monthlyCost !== null && lastBillingCandidate.monthlyCost === null) {
          lastBillingCandidate.monthlyCost = cost.monthlyCost;
          lastBillingCandidate.currency = cost.currency ?? "USD";
        }
        if (cost.rawDetails) issues.push({ code: "COMPOUND_COST", severity: "warning", message: "Monthly cost requires review", source, value: cost.rawDetails });
        continue;
      }
      const startDate = parseDate(at("activation date", "activation"), source);
      const expiryDate = section.kind === "service" ? parseDate(at("expiry date", "expiry", "deactivation date"), source) : null;
      if (startDate && expiryDate && startDate >= expiryDate) issues.push({ code: "CONTRADICTORY_DATES", severity: "error", message: "Expiry must follow activation", source });
      const renewalProcedureStartDate = section.kind === "service" ? parseDate(at("starting date renewal or termination procedure", "procedure start", "renewal procedure start", "renewal procedure start date"), source) : null;
      if (renewalProcedureStartDate && expiryDate && renewalProcedureStartDate > expiryDate) issues.push({ code: "CONTRADICTORY_DATES", severity: "error", message: "Procedure start cannot follow expiry", source });
      const cost = parseImportCost(rawCost); if (cost.rawDetails) issues.push({ code: "COMPOUND_COST", severity: "warning", message: "Monthly cost requires review", source, value: cost.rawDetails });
      const currency = cost.currency ?? (cost.monthlyCost !== null && section.headers.some((header) => billingCostKeys.includes(header)) ? "USD" : null);
      if (rawOrderValues.length === 0) { issues.push({ code: "MISSING_IDENTIFIER", severity: "error", message: "Equinix row has no service order", source }); continue; }
      const orderValues: string[] = []; const normalizedOrders = new Set<string>();
      for (const orderValue of rawOrderValues) {
        const normalized = normalizeIdentifier(orderValue);
        if (normalizedOrders.has(normalized)) { issues.push({ code: "DUPLICATE_IDENTIFIER", severity: "warning", message: `Duplicate service order ${normalized} was ignored`, source, value: orderValue }); continue; }
        normalizedOrders.add(normalized); orderValues.push(orderValue);
      }
      const primary = orderValues[0]; const provider = resolveCanonicalProvider("", at("provider name", "provider") || "Equinix");
      if (!provider) { issues.push({ code: "MISSING_PROVIDER", severity: "error", message: "Equinix row has no provider", source }); continue; }
      if (!providers.has(provider.code)) providers.set(provider.code, { ...provider, sources: [source] });
      const notes = [section.kind === "service" ? at("order validity") : "", section.kind === "billing" ? at("description") : "", nrcIndex >= 0 && at("nrc (usd)") ? `NRC: ${at("nrc (usd)")}` : "", at("remark", "notes")].filter(Boolean).join("\n") || null;
      const candidate: CircuitImportCandidate = {
        candidateKey: `${provider.code}:${normalizeIdentifier(primary)}`, providerCode: provider.code, providerName: provider.name,
        externalCircuitId: primary, identifierType: "durable",
        identifiers: orderValues.map((identifier, identifierIndex) => importIdentifier(identifierIndex === 0 ? "service_order" : "alternate", identifier, identifierIndex === 0)),
        serviceType: at("service type", "service", "type of service") || null, capacity: at("capacity") || null, location: at("location") || null,
        segment: null, connectedRouter: null, startDate, expiryDate, renewalProcedureStartDate,
        monthlyCost: cost.monthlyCost, currency, rawCostDetails: cost.rawDetails, notes,
        ...classifyImportLifecycle(expiryDate, businessDate), sources: [source],
      };
      circuitCandidates.push(candidate); lastBillingCandidate = section.kind === "billing" ? candidate : null;
    }
    if (!foundHeader) issues.push({ code: "INVALID_SHEET_STRUCTURE", severity: "error", message: "Singapore Equinix header was not found", source: { sheetName: sheet.name, rowNumber: 1 } });
    return { providers: [...providers.values()], circuitCandidates, issues };
  },
};
