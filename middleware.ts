import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicConfig } from "@/lib/config";
import { isExpectedUnauthenticatedError } from "@/lib/domain/auth-errors";

const publicPaths = ["/login", "/setup"];
const middlewareBypassPaths = [
  "/auth/callback",
  "/robots.txt",
  "/favicon.ico",
  "/icon",
  "/icon.png",
  "/apple-icon",
  "/apple-icon.png",
  "/brand",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isBypassed =
    pathname.startsWith("/_next/") ||
    middlewareBypassPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  if (isBypassed) {
    return NextResponse.next();
  }

  const isPublicPath = publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const isCronPath = pathname === "/api/cron/expiry-notifications";

  const config = getPublicConfig();
  if (!config.configured || !config.supabaseUrl || !config.supabaseAnonKey) {
    if (isPublicPath || isCronPath) return NextResponse.next();
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: { code: "CONFIGURATION_MISSING", message: "Authentication services are not configured" } }, { status: 503 });
    }
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  let response = NextResponse.next({ request });
  const redirectWithSession = (destination: string) => {
    const redirectResponse = NextResponse.redirect(new URL(destination, request.url));
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  };
  const supabase = createServerClient(config.supabaseUrl, config.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      },
    },
  });
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) {
    if (!isExpectedUnauthenticatedError(authError)) {
      if (pathname.startsWith("/api/") && !isCronPath) {
        return NextResponse.json({ error: { code: "AUTH_SERVICE_UNAVAILABLE", message: "Authentication service is unavailable" } }, { status: 503 });
      }
      if (!isPublicPath && !isCronPath) return redirectWithSession("/login?error=service-unavailable");
    }
  }

  const hasAuthenticatedUser = Boolean(user) && !authError;

  // Profile-blind middleware: page/API layers (requireProfile / requireApiProfile)
  // enforce active-profile and role rules. Keeping the profiles query out of
  // middleware removes a database round trip from every request. Authenticated
  // users are bounced off public pages; the ?error= escape on /login prevents
  // redirect loops for inactive accounts.
  if (
    hasAuthenticatedUser &&
    isPublicPath &&
    !(pathname === "/login" && request.nextUrl.searchParams.has("error"))
  ) {
    return redirectWithSession("/dashboard");
  }
  if (isPublicPath || isCronPath) {
    return response;
  }
  if (!hasAuthenticatedUser) {
    if (pathname.startsWith("/api/") && !isCronPath) {
      return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, { status: 401 });
    }
    return redirectWithSession("/login");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
