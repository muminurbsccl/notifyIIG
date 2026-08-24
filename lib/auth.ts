import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getPublicConfig } from "@/lib/config";
import { isExpectedUnauthenticatedError } from "@/lib/domain/auth-errors";
import { APP_ROLES, type AppRole } from "@/lib/domain/roles";

export { APP_ROLES } from "@/lib/domain/roles";
export type { AppRole } from "@/lib/domain/roles";

export type Profile = {
  id: string;
  email: string | null;
  full_name: string;
  role: AppRole;
  active: boolean;
  allowed_provider_ids: string[];
  created_at?: string;
  last_login_at?: string | null;
};

export class AuthError extends Error {
  constructor(
    public readonly status: 401 | 403 | 503,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export type AuthContext = {
  user: User;
  profile: Profile;
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
};

type ServerSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

// React cache() deduplicates the no-argument calls made by requireProfile so a
// single server render (layout + page) resolves authentication once instead of
// repeating the Auth and profile round trips.
export const getAuthContext = cache(
  async (initializedClient?: ServerSupabaseClient): Promise<AuthContext | null> => {
  if (!getPublicConfig().configured) return null;
  const supabase = initializedClient ?? (await createServerSupabaseClient());
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) {
    if (isExpectedUnauthenticatedError(authError)) return null;
    throw new AuthError(503, "Authentication service is unavailable");
  }
  if (!user) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,email,full_name,role,active,allowed_provider_ids,created_at,last_login_at")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw new AuthError(503, "Profile service is unavailable");
  if (!profile || !profile.active || !APP_ROLES.includes(profile.role as AppRole)) {
    return null;
  }
  return { user, profile: profile as Profile, supabase };
  },
);

export async function requireProfile(roles?: AppRole[]): Promise<AuthContext> {
  if (!getPublicConfig().configured) redirect("/setup");
  const context = await getAuthContext();
  if (!context) redirect("/login?error=not-authorized");
  if (roles && !roles.includes(context.profile.role)) {
    redirect("/dashboard?error=forbidden");
  }
  return context;
}

export async function requireApiProfile(roles?: AppRole[]): Promise<AuthContext> {
  if (!getPublicConfig().configured) {
    throw new AuthError(503, "Authentication services are not configured");
  }
  const context = await getAuthContext();
  if (!context) throw new AuthError(401, "Authentication required");
  if (roles && !roles.includes(context.profile.role)) {
    throw new AuthError(403, "You do not have permission for this action");
  }
  return context;
}

export function canAccessProvider(profile: Profile, providerId: string): boolean {
  return (
    profile.role === "admin" ||
    profile.role === "operations_editor" ||
    profile.allowed_provider_ids.includes(providerId)
  );
}

export function isRoleAtLeast(profile: Profile, roles: AppRole[]): boolean {
  return roles.includes(profile.role);
}
