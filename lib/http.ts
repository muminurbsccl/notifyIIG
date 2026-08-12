import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";

export class InputError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "InputError";
  }
}

export function jsonError(cause: unknown): NextResponse {
  if (cause instanceof AuthError) {
    return NextResponse.json(
      { error: { code: `AUTH_${cause.status}`, message: cause.message } },
      { status: cause.status },
    );
  }
  if (cause instanceof InputError) {
    return NextResponse.json({ error: { code: cause.code, message: cause.message } }, { status: cause.status });
  }
  if (cause instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          fields: cause.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "The request could not be completed" } },
    { status: 500 },
  );
}

export function jsonNotFound(message = "Record not found"): NextResponse {
  return NextResponse.json({ error: { code: "NOT_FOUND", message } }, { status: 404 });
}

export function jsonForbidden(message = "You do not have permission for this action"): NextResponse {
  return NextResponse.json({ error: { code: "FORBIDDEN", message } }, { status: 403 });
}
