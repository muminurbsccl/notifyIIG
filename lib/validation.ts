import { z } from "zod";
import { isValidDateOnly } from "@/lib/domain/date-rules";
import { APP_ROLES } from "@/lib/domain/roles";

export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine(isValidDateOnly, "Use a valid calendar date");

export const providerInputSchema = z.object({
  code: z.string().trim().min(2).max(40).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(160),
  active: z.boolean().default(false),
  defaultResponsibleOfficer: z.string().trim().max(160).nullable().optional(),
  primaryOwnerUserId: z.string().uuid().nullable().optional(),
  backupOwnerUserId: z.string().uuid().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

const circuitFields = z.object({
  providerId: z.string().uuid(),
  externalCircuitId: z.string().trim().min(1).max(160),
  identifierType: z.enum(["circuit", "link", "durable"]).default("circuit"),
  serviceType: z.string().trim().max(120).nullable().optional(),
  capacity: z.string().trim().max(120).nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  startDate: dateOnlySchema.nullable().optional(),
  expiryDate: dateOnlySchema.nullable().optional(),
  status: z.enum(["draft", "active", "renewal_pending", "renewed", "expired", "terminated", "archived"]).default("draft"),
  actionStatus: z.enum(["no_action", "reviewing", "renewal_requested", "renewal_confirmed", "termination_planned", "closed"]).default("no_action"),
  ownerUserId: z.string().uuid().nullable().optional(),
  ownerOverride: z.string().trim().max(160).nullable().optional(),
  backupOwnerUserId: z.string().uuid().nullable().optional(),
  monthlyCost: z.number().finite().nonnegative().nullable().optional(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  notificationEnabled: z.boolean().default(true),
  notificationRuleId: z.string().uuid().nullable().optional(),
  verify: z.boolean().default(false),
});

function applyDateOrder<T extends { startDate?: string | null; expiryDate?: string | null }>(input: T, context: z.RefinementCtx): void {
  if (input.startDate && input.expiryDate && input.expiryDate <= input.startDate) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["expiryDate"], message: "Expiry date must be after start date" });
  }
}

export const circuitInputSchema = circuitFields.superRefine(applyDateOrder);

export const circuitPatchSchema = circuitFields.partial().extend({
  actionStatus: circuitFields.shape.actionStatus.optional(),
  expiryDate: dateOnlySchema.nullable().optional(),
  startDate: dateOnlySchema.nullable().optional(),
}).superRefine(applyDateOrder);

export const providerManagerCircuitPatchSchema = z.object({
  actionStatus: circuitFields.shape.actionStatus.optional(),
  notes: circuitFields.shape.notes.optional(),
});

export const importDecisionSchema = z.record(z.enum(["skip", "merge", "create"]));
const canonicalUtcTimestampSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine((value) => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}, "Use a canonical UTC timestamp");
const importSourceSchema = z.object({ sheetName: z.string().trim().min(1).max(120), rowNumber: z.number().int().positive(), section: z.string().trim().min(1).max(120).optional() }).strict();
const importIdentifierSchema = z.object({
  kind: z.enum(["circuit", "link", "bscplc", "provider", "customer_link", "service_order", "alternate"]),
  value: z.string().trim().min(1).max(200), normalizedValue: z.string().min(1).max(200), primary: z.boolean(),
}).strict();
const issueShape = { message: z.string().min(1).max(1000), source: importSourceSchema.optional(), value: z.string().max(5000).optional() };
const fixedIssue = <Code extends string, Severity extends "info" | "warning" | "error">(code: Code, severity: Severity) => z.object({ code: z.literal(code), severity: z.literal(severity), ...issueShape }).strict();
const importIssueSchema = z.discriminatedUnion("code", [
  fixedIssue("IGNORED_HELPER_SHEET", "info"),
  fixedIssue("UNKNOWN_WORKSHEET", "warning"), fixedIssue("REPEATED_HEADER", "warning"), fixedIssue("COMPOUND_COST", "warning"),
  fixedIssue("UNMAPPED_CELL", "warning"), fixedIssue("DUPLICATE_IDENTIFIER", "warning"),
  fixedIssue("INVALID_SHEET_STRUCTURE", "error"), fixedIssue("MISSING_PROVIDER", "error"), fixedIssue("MISSING_IDENTIFIER", "error"),
  fixedIssue("INVALID_DATE", "error"), fixedIssue("CONTRADICTORY_DATES", "error"), fixedIssue("CONFLICTING_DUPLICATE", "error"),
  z.object({ code: z.literal("EXISTING_RECORD_COLLISION"), severity: z.literal("warning"), ...issueShape, decisionKey: z.string().min(3).max(300) }).strict(),
]);
const nullableText = (maximum: number) => z.string().max(maximum).nullable();
const importCandidateSchema = z.object({
  candidateKey: z.string().min(3).max(300), providerCode: z.string().regex(/^[A-Z0-9]+(?:_[A-Z0-9]+)*$/).max(80), providerName: z.string().trim().min(1).max(160),
  externalCircuitId: z.string().trim().min(1).max(200), identifierType: z.enum(["circuit", "link", "durable"]),
  identifiers: z.array(importIdentifierSchema).min(1).max(50), serviceType: nullableText(120), capacity: nullableText(120), location: nullableText(200),
  segment: nullableText(200), connectedRouter: nullableText(200), startDate: dateOnlySchema.nullable(), expiryDate: dateOnlySchema.nullable(),
  renewalProcedureStartDate: dateOnlySchema.nullable(), monthlyCost: z.number().finite().nonnegative().max(999_999_999_999.99).nullable(),
  currency: z.string().length(3).regex(/^[A-Z]{3}$/).nullable(), rawCostDetails: nullableText(5000), notes: nullableText(5000),
  status: z.enum(["draft", "active", "expired"]), notificationEnabled: z.boolean(), ownerOverride: nullableText(160),
  sources: z.array(importSourceSchema).min(1).max(100),
}).strict().superRefine((candidate, context) => {
  const primary = candidate.identifiers.filter((identifier) => identifier.primary);
  if (primary.length !== 1) context.addIssue({ code: z.ZodIssueCode.custom, path: ["identifiers"], message: "Exactly one primary identifier is required" });
  if (primary.length === 1) {
    if (candidate.externalCircuitId !== primary[0].value) context.addIssue({ code: z.ZodIssueCode.custom, path: ["externalCircuitId"], message: "Display identifier must equal the primary identifier" });
    if (candidate.candidateKey !== `${candidate.providerCode}:${primary[0].normalizedValue}`) context.addIssue({ code: z.ZodIssueCode.custom, path: ["candidateKey"], message: "Candidate key must be canonical" });
  }
  const normalized = new Set<string>();
  for (const [index, identifier] of candidate.identifiers.entries()) {
    if (normalizeCircuitId(identifier.value) !== identifier.normalizedValue) context.addIssue({ code: z.ZodIssueCode.custom, path: ["identifiers", index, "normalizedValue"], message: "Identifier normalization is not canonical" });
    if (normalized.has(identifier.normalizedValue)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["identifiers", index, "normalizedValue"], message: "Normalized identifiers must be unique" });
    normalized.add(identifier.normalizedValue);
  }
  if (candidate.startDate && candidate.expiryDate && candidate.startDate >= candidate.expiryDate) context.addIssue({ code: z.ZodIssueCode.custom, path: ["expiryDate"], message: "Expiry must follow activation" });
  if (candidate.renewalProcedureStartDate && candidate.expiryDate && candidate.renewalProcedureStartDate > candidate.expiryDate) context.addIssue({ code: z.ZodIssueCode.custom, path: ["renewalProcedureStartDate"], message: "Procedure start cannot follow expiry" });
  const lifecycleValid = candidate.status === "active"
    ? Boolean(candidate.expiryDate && candidate.notificationEnabled && candidate.ownerOverride === "BSCPLC IIG Support")
    : candidate.status === "draft"
      ? candidate.expiryDate === null && !candidate.notificationEnabled && candidate.ownerOverride === null
      : Boolean(candidate.expiryDate && !candidate.notificationEnabled && candidate.ownerOverride === null);
  if (!lifecycleValid) context.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "Lifecycle, notification, owner, and expiry fields are inconsistent" });
});
const importPreviewSchema = z.object({
  providers: z.array(z.object({ name: z.string().trim().min(1).max(160), code: z.string().regex(/^[A-Z0-9]+(?:_[A-Z0-9]+)*$/).max(80), sources: z.array(importSourceSchema).min(1).max(100) }).strict()).max(500),
  circuitCandidates: z.array(importCandidateSchema).max(5000),
  issues: z.array(importIssueSchema).max(10000),
  summary: z.object({ providerCount: z.number().int().nonnegative(), inputCandidateCount: z.number().int().nonnegative(), serviceCount: z.number().int().nonnegative(), activeCount: z.number().int().nonnegative(), expiredCount: z.number().int().nonnegative(), draftCount: z.number().int().nonnegative(), mergedCount: z.number().int().nonnegative() }).strict(),
}).strict().superRefine((preview, context) => {
  const expected = {
    providerCount: preview.providers.length, serviceCount: preview.circuitCandidates.length,
    activeCount: preview.circuitCandidates.filter((candidate) => candidate.status === "active").length,
    expiredCount: preview.circuitCandidates.filter((candidate) => candidate.status === "expired").length,
    draftCount: preview.circuitCandidates.filter((candidate) => candidate.status === "draft").length,
  };
  for (const [key, value] of Object.entries(expected)) if (preview.summary[key as keyof typeof expected] !== value) context.addIssue({ code: z.ZodIssueCode.custom, path: ["summary", key], message: "Summary does not match preview records" });
  if (preview.summary.inputCandidateCount < preview.summary.serviceCount || preview.summary.inputCandidateCount - preview.summary.serviceCount !== preview.summary.mergedCount) context.addIssue({ code: z.ZodIssueCode.custom, path: ["summary", "mergedCount"], message: "Merge counts do not match input provenance" });
  if (new Set(preview.providers.map((provider) => provider.code)).size !== preview.providers.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["providers"], message: "Provider codes must be unique" });
  if (new Set(preview.circuitCandidates.map((candidate) => candidate.candidateKey)).size !== preview.circuitCandidates.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["circuitCandidates"], message: "Candidate keys must be unique" });
  const providers = new Map(preview.providers.map((provider) => [provider.code, provider.name]));
  for (const [index, candidate] of preview.circuitCandidates.entries()) if (providers.get(candidate.providerCode) !== candidate.providerName) context.addIssue({ code: z.ZodIssueCode.custom, path: ["circuitCandidates", index, "providerCode"], message: "Candidate provider must match the provider list" });
});

const importTransportFields = {
  filename: z.string().trim().min(1).max(255),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  previewChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  previewSignature: z.string().regex(/^[a-f0-9]{64}$/),
  previewIssuedAt: canonicalUtcTimestampSchema,
  sheetNames: z.array(z.string().trim().min(1).max(120)).min(1).max(50).refine((names) => new Set(names).size === names.length, "Sheet names must be unique"),
};
export const importCommitTransportSchema = z.object({ ...importTransportFields, preview: z.unknown().refine((value) => value !== undefined), decisions: z.record(z.unknown()).default({}) }).strict();
export const importCommitSchema = z.object({
  ...importTransportFields,
  preview: importPreviewSchema,
  decisions: importDecisionSchema.default({}),
}).strict().superRefine((input, context) => {
  const candidateKeys = new Set(input.preview.circuitCandidates.map((candidate) => candidate.candidateKey));
  for (const key of Object.keys(input.decisions)) if (!candidateKeys.has(key)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["decisions", key], message: "Decision key does not match a candidate" });
  for (const [index, issue] of input.preview.issues.entries()) if (issue.code === "EXISTING_RECORD_COLLISION" && (!candidateKeys.has(issue.decisionKey) || !input.decisions[issue.decisionKey])) context.addIssue({ code: z.ZodIssueCode.custom, path: ["preview", "issues", index, "decisionKey"], message: "Issue requires a canonical reviewed decision" });
  const sheetNames = new Set(input.sheetNames);
  const checkSource = (source: { sheetName: string }, path: (string | number)[]) => { if (!sheetNames.has(source.sheetName)) context.addIssue({ code: z.ZodIssueCode.custom, path, message: "Source sheet must occur in the signed workbook sheet list" }); };
  input.preview.providers.forEach((provider, providerIndex) => provider.sources.forEach((source, sourceIndex) => checkSource(source, ["preview", "providers", providerIndex, "sources", sourceIndex])));
  input.preview.circuitCandidates.forEach((candidate, candidateIndex) => candidate.sources.forEach((source, sourceIndex) => checkSource(source, ["preview", "circuitCandidates", candidateIndex, "sources", sourceIndex])));
  input.preview.issues.forEach((issue, issueIndex) => { if (issue.source) checkSource(issue.source, ["preview", "issues", issueIndex, "source"]); });
});

export const resendSchema = z.object({ reason: z.string().trim().min(5).max(1000) });

export const appRoleSchema = z.enum(APP_ROLES);

export function normalizeCircuitId(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}
