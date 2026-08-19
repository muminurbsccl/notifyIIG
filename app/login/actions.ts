"use server";

import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth";
import {
  authCallbackUrl,
  requireEmail,
  requirePassword,
  validatedAppBaseUrl,
} from "@/lib/auth-flow";
import { getServerConfig } from "@/lib/server-config";
import { createWritableServerSupabaseClient } from "@/lib/supabase/server";

function isInvalidInput(cause: unknown): boolean {
  return cause instanceof Error && cause.message === "invalid-input";
}

function isRateLimited(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: unknown }).status;
  const code = (error as { code?: unknown }).code;
  return status === 429 || code === "over_email_send_rate_limit" || code === "over_request_rate_limit";
}

function isInvalidCredentials(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: string }).code === "invalid_credentials";
}

function serviceErrorDestination(method: string): string {
  return `/login?error=service-unavailable${method ? `&method=${method}` : ""}`;
}

export async function requestMagicLink(formData: FormData): Promise<void> {
  let destination: string;
  try {
    const email = requireEmail(formData.get("email"));
    const baseUrl = validatedAppBaseUrl(getServerConfig().appBaseUrl ?? undefined);
    const supabase = await createWritableServerSupabaseClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: authCallbackUrl(baseUrl),
        shouldCreateUser: false,
      },
    });
    destination = error
      ? isRateLimited(error)
        ? "/login?error=rate-limited"
        : serviceErrorDestination("")
      : "/login?notice=link-sent";
  } catch (cause) {
    destination = isInvalidInput(cause)
      ? "/login?error=invalid-input"
      : isRateLimited(cause)
        ? "/login?error=rate-limited"
        : serviceErrorDestination("");
  }
  redirect(destination);
}

export async function signInWithPassword(formData: FormData): Promise<void> {
  let destination: string;
  try {
    const email = requireEmail(formData.get("email"));
    const password = requirePassword(formData.get("password"));
    const supabase = await createWritableServerSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      destination = isInvalidCredentials(error)
        ? "/login?error=invalid-credentials&method=password"
        : isRateLimited(error)
          ? "/login?error=rate-limited&method=password"
          : serviceErrorDestination("password");
    } else {
      const context = await getAuthContext(supabase);
      if (context) {
        destination = "/dashboard";
      } else {
        const { error: signOutError } = await supabase.auth.signOut();
        destination = signOutError
          ? "/login?error=service-unavailable&method=password"
          : "/login?error=not-authorized";
      }
    }
  } catch (cause) {
    destination = isInvalidInput(cause)
      ? "/login?error=invalid-input&method=password"
      : "/login?error=service-unavailable&method=password";
  }
  redirect(destination);
}
