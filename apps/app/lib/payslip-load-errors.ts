/**
 * Safe copy for payslip load failures. Avoids surfacing Next.js production digests,
 * Convex stack strings, or other internal messages in the UI.
 */
export const PAYSLIP_LOAD_GENERIC =
  "Something went wrong. Please try again.";

export const PAYSLIP_NOT_FOUND =
  "This payslip could not be found. It may have been removed.";

export const PAYSLIP_NOT_ALLOWED =
  "You don't have permission to view this payslip.";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

/**
 * Maps thrown errors from `getPayslip` (Convex / server action) to user-facing text.
 */
export function userFacingPayslipLoadError(error: unknown): string {
  const raw = errorMessage(error);
  const lower = raw.toLowerCase();

  if (
    lower.includes("not found") ||
    lower.includes("payslip not found")
  ) {
    return PAYSLIP_NOT_FOUND;
  }

  if (
    lower.includes("not authorized") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden")
  ) {
    return PAYSLIP_NOT_ALLOWED;
  }

  // Next.js production / digest boilerplate
  if (
    lower.includes("server components render") ||
    lower.includes("digest property") ||
    lower.includes("production builds") ||
    lower.includes("omitted in production")
  ) {
    return PAYSLIP_LOAD_GENERIC;
  }

  // Very long messages are usually stack traces or serialized errors
  if (raw.length > 280) {
    return PAYSLIP_LOAD_GENERIC;
  }

  return PAYSLIP_LOAD_GENERIC;
}

export const PAYSLIP_PIN_VERIFY_GENERIC =
  "Could not verify your PIN. Please try again.";
