import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { parseWorkbook } from "@/lib/import/xlsx";

const publicSource = (source: { sheetName: string; rowNumber: number; section?: string }) => ({ sheetName: source.sheetName, rowNumber: source.rowNumber, ...(source.section ? { section: source.section } : {}) });

export async function POST(request: Request) {
  try {
    await requireApiProfile(["admin", "operations_editor"]);
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: { code: "FILE_REQUIRED", message: "Upload an XLSX workbook" } }, { status: 400 });
    }
    const file = formData.get("file");
    if (!file || typeof file !== "object" || typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== "function") {
      return NextResponse.json({ error: { code: "FILE_REQUIRED", message: "Upload an XLSX workbook" } }, { status: 400 });
    }
    const parsed = await parseWorkbook(file);
    return NextResponse.json({ preview: {
      filename: parsed.filename, checksum: parsed.checksum, previewChecksum: parsed.previewChecksum,
      previewSignature: parsed.previewSignature, previewIssuedAt: parsed.previewIssuedAt, sheetNames: parsed.sheetNames,
      providers: parsed.providers.map((provider) => ({ name: provider.name, code: provider.code, sources: provider.sources.map(publicSource) })),
      circuitCandidates: parsed.circuitCandidates.map((candidate) => ({
        candidateKey: candidate.candidateKey, providerCode: candidate.providerCode, providerName: candidate.providerName,
        externalCircuitId: candidate.externalCircuitId, identifierType: candidate.identifierType,
        identifiers: candidate.identifiers.map((identifier) => ({ kind: identifier.kind, value: identifier.value, normalizedValue: identifier.normalizedValue, primary: identifier.primary })),
        serviceType: candidate.serviceType, capacity: candidate.capacity, location: candidate.location, segment: candidate.segment,
        connectedRouter: candidate.connectedRouter, startDate: candidate.startDate, expiryDate: candidate.expiryDate,
        renewalProcedureStartDate: candidate.renewalProcedureStartDate, monthlyCost: candidate.monthlyCost, currency: candidate.currency,
        rawCostDetails: candidate.rawCostDetails, notes: candidate.notes, status: candidate.status,
        notificationEnabled: candidate.notificationEnabled, ownerOverride: candidate.ownerOverride, sources: candidate.sources.map(publicSource),
      })),
      issues: parsed.issues.map((issue) => ({ code: issue.code, severity: issue.severity, message: issue.message,
        ...(issue.source ? { source: publicSource(issue.source) } : {}), ...(issue.value !== undefined ? { value: issue.value } : {}),
        ...(issue.decisionKey !== undefined ? { decisionKey: issue.decisionKey } : {}) })),
      summary: {
        providerCount: parsed.summary.providerCount, inputCandidateCount: parsed.summary.inputCandidateCount,
        serviceCount: parsed.summary.serviceCount, activeCount: parsed.summary.activeCount, expiredCount: parsed.summary.expiredCount,
        draftCount: parsed.summary.draftCount, mergedCount: parsed.summary.mergedCount,
      },
    } });
  } catch (cause) {
    return jsonError(cause);
  }
}
