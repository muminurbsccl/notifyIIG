export type ImportSource = {
  sheetName: string;
  rowNumber: number;
  section?: string;
};

export type ImportIssueSeverity = "info" | "warning" | "error";

export type ImportIssueCode =
  | "IGNORED_HELPER_SHEET"
  | "UNKNOWN_WORKSHEET"
  | "INVALID_SHEET_STRUCTURE"
  | "REPEATED_HEADER"
  | "MISSING_PROVIDER"
  | "MISSING_IDENTIFIER"
  | "INVALID_DATE"
  | "CONTRADICTORY_DATES"
  | "COMPOUND_COST"
  | "UNMAPPED_CELL"
  | "DUPLICATE_IDENTIFIER"
  | "CONFLICTING_DUPLICATE"
  | "EXISTING_RECORD_COLLISION";

export type ImportIssue = {
  code: ImportIssueCode;
  severity: ImportIssueSeverity;
  message: string;
  source?: ImportSource;
  value?: string;
  decisionKey?: string;
};

export type ImportIdentifier = {
  kind: "circuit" | "link" | "bscplc" | "provider" | "customer_link" | "service_order" | "alternate";
  value: string;
  normalizedValue: string;
  primary: boolean;
};

export type ImportProvider = {
  code: string;
  name: string;
  sources: ImportSource[];
};

export type CircuitImportCandidate = {
  candidateKey: string;
  providerCode: string;
  providerName: string;
  externalCircuitId: string;
  identifierType: "circuit" | "link" | "durable";
  identifiers: ImportIdentifier[];
  serviceType: string | null;
  capacity: string | null;
  location: string | null;
  segment: string | null;
  connectedRouter: string | null;
  startDate: string | null;
  expiryDate: string | null;
  renewalProcedureStartDate: string | null;
  monthlyCost: number | null;
  currency: string | null;
  rawCostDetails: string | null;
  notes: string | null;
  status: "draft" | "active" | "expired";
  notificationEnabled: boolean;
  ownerOverride: string | null;
  sources: ImportSource[];
};

export type ImportPreview = {
  providers: ImportProvider[];
  circuitCandidates: CircuitImportCandidate[];
  issues: ImportIssue[];
  summary: {
    providerCount: number;
    inputCandidateCount: number;
    serviceCount: number;
    activeCount: number;
    expiredCount: number;
    draftCount: number;
    mergedCount: number;
  };
};

export function classifyImportLifecycle(
  expiryDate: string | null,
  businessDate: string,
): Pick<CircuitImportCandidate, "status" | "notificationEnabled" | "ownerOverride"> {
  if (!expiryDate) {
    return { status: "draft", notificationEnabled: false, ownerOverride: null };
  }
  if (expiryDate < businessDate) {
    return { status: "expired", notificationEnabled: false, ownerOverride: null };
  }
  return {
    status: "active",
    notificationEnabled: true,
    ownerOverride: "BSCPLC IIG Support",
  };
}
