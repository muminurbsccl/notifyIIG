export type SourceLineage = {
  sheetName: string;
  rowNumber: number;
};

export type ImportIssueCode =
  | "INVALID_HEADER"
  | "UNSUPPORTED_SHEET"
  | "MISSING_PROVIDER"
  | "MISSING_IDENTIFIER"
  | "INVOICE_ONLY"
  | "AMBIGUOUS_IDENTIFIER"
  | "DUPLICATE_IDENTIFIER";

export type ImportIssue = {
  code: ImportIssueCode;
  message: string;
  source?: SourceLineage;
  value?: string;
  decisionKey?: string;
};

export type ImportProvider = {
  name: string;
  code: string;
  source: SourceLineage;
};

export type CircuitCandidate = {
  providerName: string;
  externalCircuitId: string;
  identifierType: "circuit" | "link" | "durable";
  source: SourceLineage;
  duplicate?: boolean;
};

export type InvoiceReference = {
  providerName: string;
  referenceNumber: string;
  source: SourceLineage;
};

export type ImportPreview = {
  providers: ImportProvider[];
  circuitCandidates: CircuitCandidate[];
  invoiceReferences: InvoiceReference[];
  issues: ImportIssue[];
};

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function headerKey(value: unknown): string {
  return cellText(value)
    .toLowerCase()
    .replace(/[._/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function providerCode(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function canonicalCircuitId(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

function isInvoiceLike(value: string): boolean {
  return /^(invoice|inv|bill)(?:(?:[\s\-/:]+)\S+|\d+|$)/i.test(value);
}

function isAmbiguous(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    (normalized.includes("ip") && normalized.includes("lag")) ||
    normalized.includes("bundle") ||
    normalized.includes("multiple records")
  );
}

function pushProvider(
  providers: ImportProvider[],
  seenProviders: Set<string>,
  name: string,
  source: SourceLineage,
): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const code = providerCode(trimmed);
  if (!seenProviders.has(code)) {
    seenProviders.add(code);
    providers.push({ name: trimmed, code, source });
  }
}

function findColumn(headers: string[], aliases: string[]): number {
  return headers.findIndex((header) => aliases.includes(header));
}

export function normalizeWorkbookRows(
  rows: unknown[][],
  sheetName = "Sheet1",
): ImportPreview {
  const providers: ImportProvider[] = [];
  const circuitCandidates: CircuitCandidate[] = [];
  const invoiceReferences: InvoiceReference[] = [];
  const issues: ImportIssue[] = [];
  const seenProviders = new Set<string>();
  const seenCircuits = new Set<string>();

  if (sheetName.toLowerCase() === "sheet2") {
    return {
      providers,
      circuitCandidates,
      invoiceReferences,
      issues: [
        {
          code: "UNSUPPORTED_SHEET",
          message: "Narrative sheets require manual review and are not imported automatically",
          source: { sheetName, rowNumber: 1 },
        },
      ],
    };
  }

  const headerRowIndex = rows.findIndex((row) => {
    const keys = row.map(headerKey);
    return keys.some((key) =>
      ["provider", "provider name", "vendor", "circuit link id", "circuit id", "link id", "circuit link identifier", "invoice no", "invoice number"].includes(key),
    );
  });

  if (headerRowIndex < 0) {
    issues.push({ code: "INVALID_HEADER", message: "No recognizable workbook header row was found" });
    return { providers, circuitCandidates, invoiceReferences, issues };
  }

  let activeProvider = "";
  for (let index = 0; index < headerRowIndex; index += 1) {
    const values = (rows[index] ?? []).map(cellText).filter(Boolean);
    if (values.length === 1) {
      activeProvider = values[0];
      pushProvider(providers, seenProviders, activeProvider, { sheetName, rowNumber: index + 1 });
    }
  }

  const headers = (rows[headerRowIndex] ?? []).map(headerKey);
  const providerIndex = findColumn(headers, ["provider", "provider name", "vendor"]);
  const identifierIndex = findColumn(headers, ["circuit link id", "circuit id", "link id", "circuit link identifier"]);
  const invoiceIndex = findColumn(headers, ["invoice no", "invoice number", "invoice reference"]);
  if (identifierIndex < 0 && invoiceIndex < 0) {
    issues.push({
      code: "INVALID_HEADER",
      message: "Workbook header has neither a circuit/link identifier nor invoice column",
      source: { sheetName, rowNumber: headerRowIndex + 1 },
    });
    return { providers, circuitCandidates, invoiceReferences, issues };
  }

  for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
    const rawRow = rows[index] ?? [];
    const values = rawRow.map(cellText);
    if (!values.some(Boolean)) continue;

    const source = { sheetName, rowNumber: index + 1 };
    const rowProvider = providerIndex >= 0 ? values[providerIndex] ?? "" : "";
    const providerName = rowProvider || activeProvider;
    const identifier = identifierIndex >= 0 ? values[identifierIndex] ?? "" : "";
    const invoice = invoiceIndex >= 0 ? values[invoiceIndex] ?? "" : "";

    if (providerIndex < 0 && !identifier && !invoice && values.filter(Boolean).length === 1) {
      activeProvider = values.find(Boolean) ?? activeProvider;
      pushProvider(providers, seenProviders, activeProvider, source);
      continue;
    }

    if (!providerName) {
      issues.push({ code: "MISSING_PROVIDER", message: "Row has no provider section or provider value", source });
      continue;
    }
    pushProvider(providers, seenProviders, providerName, source);

    if (invoice) {
      invoiceReferences.push({ providerName, referenceNumber: invoice, source });
    }

    if (identifier) {
      if (isAmbiguous(identifier)) {
        issues.push({ code: "AMBIGUOUS_IDENTIFIER", message: "Identifier requires manual normalization", source, value: identifier });
      } else if (isInvoiceLike(identifier)) {
        invoiceReferences.push({ providerName, referenceNumber: identifier, source });
        issues.push({ code: "INVOICE_ONLY", message: "Invoice-like value was retained as a reference, not a circuit ID", source, value: identifier });
      } else {
        const canonicalIdentifier = canonicalCircuitId(identifier);
        const circuitKey = `${providerCode(providerName)}:${canonicalIdentifier}`;
        if (seenCircuits.has(circuitKey)) {
          const decisionKey = `${providerCode(providerName)}:${canonicalIdentifier}`;
          issues.push({ code: "DUPLICATE_IDENTIFIER", message: "Duplicate provider and durable identifier requires a decision", source, value: identifier, decisionKey });
          circuitCandidates.push({
            providerName,
            externalCircuitId: identifier,
            identifierType: headers[identifierIndex]?.includes("link") ? "link" : "circuit",
            source,
            duplicate: true,
          });
        } else {
          seenCircuits.add(circuitKey);
          circuitCandidates.push({
            providerName,
            externalCircuitId: identifier,
            identifierType: headers[identifierIndex]?.includes("link") ? "link" : "circuit",
            source,
          });
        }
      }
    } else if (invoice) {
      issues.push({ code: "INVOICE_ONLY", message: "Invoice-only row requires manual circuit association", source, value: invoice });
    } else {
      issues.push({ code: "MISSING_IDENTIFIER", message: "Row has neither a durable circuit/link ID nor invoice reference", source });
    }
  }

  return { providers, circuitCandidates, invoiceReferences, issues };
}
