import { NextResponse } from "next/server";
import { runExpiryNotificationJob } from "@/lib/notifications/engine";
import { getServerConfig } from "@/lib/server-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function verifyCronRequest(request: Request): boolean {
  const secret = getServerConfig().cronSecret;
  if (!secret) return false;
  return (request.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Unauthorized" } },
      { status: 401 },
    );
  }
  try {
    return NextResponse.json(await runExpiryNotificationJob());
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "CRON_JOB_FAILED", message: "The notification job failed" } },
      { status: 500 },
    );
  }
}
