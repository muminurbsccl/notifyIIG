export function isExpectedUnauthenticatedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; status?: number };
  return (
    (candidate.name === "AuthSessionMissingError" && candidate.status === 400) ||
    candidate.status === 401 ||
    candidate.status === 403
  );
}
