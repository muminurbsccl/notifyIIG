import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiProfile } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { listCircuits, toCircuitRow } from "@/lib/data";
import { circuitInputSchema } from "@/lib/validation";
import { writeAudit } from "@/lib/audit";

function invalidActivation(input: z.infer<typeof circuitInputSchema>): string | null {
  if (!["active", "renewal_pending"].includes(input.status)) return null;
  if (!input.expiryDate) return "A verified expiry date is required before activation";
  if (!input.ownerUserId && !input.ownerOverride) return "A responsible officer is required before activation";
  if (!input.verify) return "Activation requires an explicit verification action";
  return null;
}

export async function GET(request: Request) {
  try {
    const auth = await requireApiProfile();
    const params = new URL(request.url).searchParams;
    const circuits = await listCircuits(auth.supabase, {
      search: params.get("search") ?? undefined,
      providerId: params.get("providerId") ?? undefined,
      status: params.get("status") ?? undefined,
    });
    return NextResponse.json({ circuits });
  } catch (cause) {
    return jsonError(cause);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireApiProfile(["admin", "operations_editor"]);
    const input = circuitInputSchema.parse(await request.json());
    const activationError = invalidActivation(input);
    if (activationError) {
      return NextResponse.json({ error: { code: "ACTIVATION_REQUIRES_VERIFICATION", message: activationError } }, { status: 422 });
    }
    const verifiedAt = input.verify ? new Date().toISOString() : null;
    const row = toCircuitRow(input, input.verify ? auth.user.id : null, verifiedAt);
    const { data, error } = await auth.supabase.from("circuits").insert(row).select().single();
    if (error) throw error;
    await writeAudit({ actorUserId: auth.user.id, action: "circuit.create", entityType: "circuit", entityId: data.id, after: data, requestId: request.headers.get("x-request-id") });
    return NextResponse.json({ circuit: data }, { status: 201 });
  } catch (cause) {
    return jsonError(cause);
  }
}
