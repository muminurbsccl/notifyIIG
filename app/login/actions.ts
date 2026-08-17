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

function isInvalidCredentials(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: string }).code === "invalid_credentials";
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
      ? "/login?error=service-unavailable"
      : "/login?notice=link-sent";
  } catch (cause) {
    destination = isInvalidInput(cause)
      ? "/login?error=invalid-input"
      : "/login?error=service-unavailable";
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
        : "/login?error=service-unavailable&method=password";
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
