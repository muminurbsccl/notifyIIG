export type LoginResultState =
  | "link-sent"
  | "invalid-input"
  | "invalid-credentials"
  | "not-authorized"
  | "invalid-link"
  | "service-unavailable";

const PRODUCTION_APP_ORIGIN = "https://notifyiig.vercel.app";
const DEFAULT_INTERNAL_DESTINATION = "/dashboard";

function isSafeInternalPath(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return false;

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }
  if (decoded.startsWith("//") || decoded.includes("\\")) return false;

  try {
    return new URL(value, "https://internal.invalid").origin === "https://internal.invalid";
  } catch {
    return false;
  }
}

export function safeInternalDestination(
  value: string | null,
  fallback = DEFAULT_INTERNAL_DESTINATION,
): string {
  if (value && isSafeInternalPath(value)) return value;
  return isSafeInternalPath(fallback) ? fallback : DEFAULT_INTERNAL_DESTINATION;
}

export function validatedAppBaseUrl(value: string | undefined): URL {
  if (!value) throw new Error("APP_BASE_URL is required");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("APP_BASE_URL must be a valid URL");
  }

  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("APP_BASE_URL must use HTTPS outside local development");
  }
  if (!local && url.origin !== PRODUCTION_APP_ORIGIN) {
    throw new Error("APP_BASE_URL must use the approved production origin");
  }
  if (url.username || url.password) {
    throw new Error("APP_BASE_URL must not contain credentials");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("APP_BASE_URL must contain only an origin");
  }

  return url;
}

export function authCallbackUrl(baseUrl: URL): string {
  return new URL("/auth/callback", baseUrl).toString();
}

export function requireEmail(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") throw new Error("invalid-input");
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("invalid-input");
  }
  return email;
}

export function requirePassword(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("invalid-input");
  }
  return value;
}
