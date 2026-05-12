/**
 * On hard refresh, org-scoped Convex queries can run before the client JWT is attached.
 * Match the grace list used in employees.getEmployees / settings.getSettings: return
 * empty/null from queries instead of throwing so the app can hydrate, then Convex
 * re-runs once authenticated.
 */
export function isOrgQueryAuthGraceError(error: unknown): boolean {
  const msg =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
      ? (error as { message: string }).message
      : String(error ?? "");
  return (
    msg.includes("Not authenticated") ||
    msg.includes("Unauthenticated") ||
    msg.includes("User not found") ||
    msg.includes("User record not found") ||
    msg.includes("Please complete your account setup") ||
    msg.includes("Not authorized") ||
    msg.includes("User is not a member")
  );
}

export async function runOrgQuery<T>(
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isOrgQueryAuthGraceError(e)) return fallback;
    throw e;
  }
}
