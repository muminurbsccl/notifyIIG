import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { providerInputSchema } from "@/lib/validation";
import { listProviders } from "@/lib/data";
import { writeAudit } from "@/lib/audit";

export async function GET(request: Request) {
  try {
    const context = await requireApiProfile();
    const search = new URL(request.url).searchParams.get("search") ?? undefined;
    return NextResponse.json({ providers: await listProviders(context.supabase, search) });
  } catch (cause) {
    return jsonError(cause);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireApiProfile(["admin", "operations_editor"]);
    const input = providerInputSchema.parse(await request.json());
    if (input.active && !input.primaryOwnerUserId && !input.defaultResponsibleOfficer) {
      return NextResponse.json({ error: { code: "OWNER_REQUIRED", message: "An active provider needs a primary responsible officer" } }, { status: 422 });
    }
    const row = {
      code: input.code,
      name: input.name,
      active: input.active,
      default_responsible_officer: input.defaultResponsibleOfficer ?? null,
      primary_owner_user_id: input.primaryOwnerUserId ?? null,
      backup_owner_user_id: input.backupOwnerUserId ?? null,
      notes: input.notes ?? null,
    };
    const { data, error } = await context.supabase.from("providers").insert(row).select().single();
    if (error) throw error;
    await writeAudit({ actorUserId: context.user.id, action: "provider.create", entityType: "provider", entityId: data.id, after: data, requestId: request.headers.get("x-request-id") });
    return NextResponse.json({ provider: data }, { status: 201 });
  } catch (cause) {
    return jsonError(cause);
  }
}
