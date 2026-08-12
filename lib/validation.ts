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
const importIssueCodeSchema = z.enum([
  "INVALID_HEADER",
  "UNSUPPORTED_SHEET",
  "MISSING_PROVIDER",
  "MISSING_IDENTIFIER",
  "INVOICE_ONLY",
  "AMBIGUOUS_IDENTIFIER",
  "DUPLICATE_IDENTIFIER",
]);

export const importCommitSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  previewChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  previewSignature: z.string().regex(/^[a-f0-9]{64}$/),
  sheetNames: z.array(z.string().max(120)).max(50),
  preview: z.object({
    providers: z.array(z.object({ name: z.string(), code: z.string(), source: z.object({ sheetName: z.string(), rowNumber: z.number().int().positive() }) })),
    circuitCandidates: z.array(z.object({
      providerName: z.string(),
      externalCircuitId: z.string(),
      identifierType: z.enum(["circuit", "link", "durable"]),
      source: z.object({ sheetName: z.string(), rowNumber: z.number().int().positive() }),
      duplicate: z.boolean().optional(),
    })),
    invoiceReferences: z.array(z.object({
      providerName: z.string(),
      referenceNumber: z.string(),
      source: z.object({ sheetName: z.string(), rowNumber: z.number().int().positive() }),
    })),
    issues: z.array(z.object({ code: importIssueCodeSchema, message: z.string(), source: z.object({ sheetName: z.string(), rowNumber: z.number().int().positive() }).optional(), value: z.string().optional(), decisionKey: z.string().optional() })),
  }),
  decisions: importDecisionSchema.default({}),
});

export const resendSchema = z.object({ reason: z.string().trim().min(5).max(1000) });

export const appRoleSchema = z.enum(APP_ROLES);

export function normalizeCircuitId(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}
