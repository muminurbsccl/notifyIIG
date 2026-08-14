import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { safeInternalDestination } from "@/lib/auth-flow";
import { getPublicConfig } from "@/lib/config";

type PendingCookie = { name: string; value: string; options: CookieOptions };

function isProviderUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: number }).status;
  return status === 429 || (typeof status === "number" && status >= 500);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const pendingCookies: PendingCookie[] = [];
  const redirectWithCookies = (destination: string): NextResponse => {
    const response = NextResponse.redirect(new URL(destination, request.url));
    for (const { name, value, options } of pendingCookies) {
      response.cookies.set(name, value, options);
    }
    return response;
  };

  const code = request.nextUrl.searchParams.get("code");
  if (!code || code.length > 4096) {
    return redirectWithCookies("/login?error=invalid-link");
  }

  const config = getPublicConfig();
  if (!config.configured || !config.supabaseUrl || !config.supabaseAnonKey) {
    return redirectWithCookies("/login?error=service-unavailable");
  }

  const supabase = createServerClient(config.supabaseUrl, config.supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        pendingCookies.push(...cookiesToSet);
      },
    },
  });

  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return redirectWithCookies(
        isProviderUnavailable(error)
          ? "/login?error=service-unavailable"
          : "/login?error=invalid-link",
      );
    }

    const context = await getAuthContext(supabase);
    if (!context) {
      const { error: signOutError } = await supabase.auth.signOut();
      return redirectWithCookies(
        signOutError
          ? "/login?error=service-unavailable"
          : "/login?error=not-authorized",
      );
    }

    const next = safeInternalDestination(request.nextUrl.searchParams.get("next"));
    return redirectWithCookies(next);
  } catch {
    return redirectWithCookies("/login?error=service-unavailable");
  }
}
