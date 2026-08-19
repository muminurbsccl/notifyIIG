"use server";

import { createClient } from "@supabase/supabase-js";
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

function createServiceRoleClient() {
  const { supabaseUrl, serviceRoleKey } = getServerConfig();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("service configuration is missing");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
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

export async function beginSignIn(formData: FormData): Promise<void> {
  let destination: string;
  try {
    const email = requireEmail(formData.get("email"));
    const { data, error } = await createServiceRoleClient().rpc(
      "auth_user_has_password",
      { email },
    );
    if (error) throw error;

    if (data === true) {
      destination = `/login?step=password&email=${encodeURIComponent(email)}`;
    } else {
      // Passwordless or unknown email: identical path (anti-enumeration).
      const baseUrl = validatedAppBaseUrl(getServerConfig().appBaseUrl ?? undefined);
      const supabase = await createWritableServerSupabaseClient();
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: authCallbackUrl(baseUrl),
          shouldCreateUser: false,
        },
      });
      destination = otpError
        ? isRateLimited(otpError)
          ? "/login?error=rate-limited"
          : otpError.code === "otp_disabled"
            ? "/login?notice=link-sent"
            : serviceErrorDestination("")
        : "/login?notice=link-sent";
    }
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
  const step = formData.get("step") === "password";
  const rawEmail = formData.get("email");
  const emailParam = step
    ? `&step=password&email=${encodeURIComponent(String(rawEmail ?? ""))}`
    : "";
  const methodParam = step ? "" : "&method=password";
  const errorDestination = (key: string): string =>
    `/login?error=${key}${step ? emailParam : methodParam}`;

  let destination: string;
  try {
    const email = requireEmail(rawEmail);
    const password = requirePassword(formData.get("password"));
    const supabase = await createWritableServerSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      destination = isInvalidCredentials(error)
        ? errorDestination("invalid-credentials")
        : isRateLimited(error)
          ? errorDestination("rate-limited")
          : errorDestination("service-unavailable");
    } else {
      const context = await getAuthContext(supabase);
      if (context) {
        destination = "/dashboard";
      } else {
        const { error: signOutError } = await supabase.auth.signOut();
        destination = signOutError
          ? errorDestination("service-unavailable")
          : `/login?error=not-authorized${step ? emailParam : ""}`;
      }
    }
  } catch (cause) {
    destination = isInvalidInput(cause)
      ? `/login?error=invalid-input${step ? emailParam : "&method=password"}`
      : errorDestination("service-unavailable");
  }
  redirect(destination);
}
