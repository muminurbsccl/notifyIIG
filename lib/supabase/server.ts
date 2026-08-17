import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicConfig } from "@/lib/config";

type CookieWriteMode = "best-effort" | "required";

async function createConfiguredServerClient(cookieWriteMode: CookieWriteMode) {
  const config = getPublicConfig();
  if (!config.configured || !config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error("Supabase public configuration is missing");
  }

  const cookieStore = await cookies();
  return createServerClient(config.supabaseUrl, config.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch (cause) {
          if (cookieWriteMode === "required") throw cause;
          // Server components can read cookies but cannot always write them.
          // Middleware performs the session refresh for those requests.
        }
      },
    },
  });
}

export async function createServerSupabaseClient() {
  return createConfiguredServerClient("best-effort");
}

export async function createWritableServerSupabaseClient() {
  return createConfiguredServerClient("required");
}
